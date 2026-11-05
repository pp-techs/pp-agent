import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename, join, resolve, sep } from "node:path";
import { PairingGuard, translate as t, type RemoteAccessControl } from "@workspace/agent-core";
import {
  type AgentCommand,
  type AgentEvent,
  type Attachment,
  type RemoteAccessState,
  type RemoteAccessStatus,
  type RemoteDevice,
  remoteMayRun,
} from "@workspace/shared";
import {
  applySecurityHeaders,
  bearerToken,
  HttpError,
  lanUrls,
  readBody,
  sameOrigin,
  sendJson,
  serveStatic,
} from "./http.ts";
import { RemoteStore, type StoredDevice, validPort } from "./store.ts";

/** A command carries at most a voice recording or a pasted image or two. */
const MAX_COMMAND_BYTES = 48 * 1024 * 1024;
const MAX_PAIR_BYTES = 4 * 1024;
export const MAX_UPLOAD_MB = 100;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
/** Keeps idle connections (and the proxies between) from closing a quiet event stream. */
const HEARTBEAT_MS = 20_000;
/** A device that leaves this much unread is gone or stuck; its stream is dropped. */
const MAX_STREAM_BACKLOG = 32 * 1024 * 1024;
/** Uploaded files are copied into the workspace when sent; leftovers go after a day. */
const UPLOAD_MAX_AGE_MS = 24 * 60 * 60_000;
const UPLOAD_SWEEP_MS = 60 * 60_000;

export interface RemoteServerOptions {
  /** `remote.json` (settings and paired devices). */
  file: string;
  /** Where uploads from devices wait until a message sends them. */
  uploadsDir: string;
  /** The built web app's folder, looked up each time the server starts listening. */
  webDir(): string | null;
  /** Runs a command on the agent host, as a desktop client's command would. */
  handle(command: AgentCommand): Promise<unknown>;
  /** Tells every client (the desktop window too) that Settings › Phone access changed. */
  emit(event: AgentEvent): void;
  appVersion: string;
  /** Interface to listen on; every one by default, so phones on the network can reach it. */
  host?: string;
  log?(message: string): void;
  now?(): number;
}

interface EventStream {
  res: ServerResponse;
  deviceId: string;
  heartbeat: NodeJS.Timeout;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A file name safe to create: no folders, no control characters, not empty. */
function safeFileName(name: string): string {
  const clean = basename(name.replace(/\\/g, "/"))
    .replace(/\p{Cc}/gu, "")
    .trim()
    .slice(0, 120);
  return clean === "" || clean === "." || clean === ".." ? "file" : clean;
}

function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, t("remote.badRequest"));
  }
}

/**
 * Serves the web app to phones and other computers on the local network (Settings › Phone
 * access). Off by default. A device pairs with the one-time code shown on the computer and then
 * signs every request with its own token (`Authorization: Bearer`); events stream to it over
 * Server-Sent Events, and commands run on the same agent host as the desktop window's.
 */
export class RemoteServer implements RemoteAccessControl {
  private readonly store: RemoteStore;
  private readonly guard = new PairingGuard();
  private readonly streams = new Set<EventStream>();
  private readonly options: RemoteServerOptions;
  private server: Server | null = null;
  private state: RemoteAccessState = "off";
  private error: string | null = null;
  /** Changes to the listener happen one at a time. */
  private queue: Promise<unknown> = Promise.resolve();
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(options: RemoteServerOptions) {
    this.options = options;
    this.store = new RemoteStore(options.file);
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** Loads `remote.json` and starts listening when phone access was left on. */
  async start(): Promise<void> {
    await this.store.load();
    await this.sweepUploads();
    this.sweepTimer = setInterval(() => void this.sweepUploads(), UPLOAD_SWEEP_MS);
    this.sweepTimer.unref();
    if (this.store.enabled) await this.serialize(() => this.listen(this.store.port));
  }

  async close(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    await this.serialize(() => this.stopListening());
  }

  /** Port the server listens on right now (useful when it was started on port 0 in tests). */
  get listeningPort(): number | null {
    const address = this.server?.address();
    return address && typeof address === "object" ? address.port : null;
  }

  // -------------------------------------------------------------------------------------------
  // Commands from the computer (through the agent host)
  // -------------------------------------------------------------------------------------------

  async status(): Promise<RemoteAccessStatus> {
    const now = this.now();
    const pairing = this.guard.current(now);
    const connected = new Set([...this.streams].map((stream) => stream.deviceId));
    const devices: RemoteDevice[] = this.store.devices
      .map((device) => ({
        id: device.id,
        name: device.name || t("remote.defaultDeviceName"),
        pairedAt: device.pairedAt,
        lastSeenAt: device.lastSeenAt,
        connected: connected.has(device.id),
      }))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    const port = this.listeningPort ?? this.store.port;
    return {
      enabled: this.store.enabled,
      port: this.store.port,
      state: this.state,
      error: this.error,
      urls: this.state === "listening" ? lanUrls(port) : [],
      pairingCode: pairing?.code ?? null,
      pairingExpiresAt: pairing?.expiresAt ?? null,
      devices,
    };
  }

  set(enabled: boolean, port?: number): Promise<RemoteAccessStatus> {
    return this.serialize(async () => {
      const nextPort = port ?? this.store.port;
      if (!validPort(nextPort)) throw new Error(t("remote.invalidPort"));
      const portChanged = nextPort !== this.store.port;
      await this.store.configure(enabled, nextPort);
      if (!enabled) {
        this.guard.close();
        await this.stopListening();
      } else if (portChanged || this.server === null) {
        await this.stopListening();
        await this.listen(nextPort);
      }
      this.changed();
      return this.status();
    });
  }

  async startPairing(): Promise<RemoteAccessStatus> {
    if (this.state !== "listening") throw new Error(t("remote.notOn"));
    this.guard.open(this.now());
    this.changed();
    return this.status();
  }

  async forgetDevice(id: string): Promise<RemoteAccessStatus> {
    if (!(await this.store.removeDevice(id))) throw new Error(t("remote.deviceUnknown"));
    this.closeStreams((stream) => stream.deviceId === id);
    this.changed();
    return this.status();
  }

  /** Sends an agent event to every device that is listening. */
  broadcast(event: AgentEvent): void {
    if (this.streams.size === 0) return;
    const chunk = `data: ${JSON.stringify(event)}\n\n`;
    for (const stream of this.streams) this.write(stream, chunk);
  }

  // -------------------------------------------------------------------------------------------
  // Listener
  // -------------------------------------------------------------------------------------------

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private changed(): void {
    this.options.emit({ type: "settings_changed", scopes: ["remoteAccess"] });
  }

  private async listen(port: number): Promise<void> {
    const webDir = this.options.webDir();
    if (!webDir) {
      this.state = "error";
      this.error = t("remote.webMissing");
      this.options.log?.("Phone access: the web app is not built.");
      return;
    }
    const server = createServer((req, res) => void this.onRequest(req, res, webDir));
    // Event streams stay open for as long as the page does.
    server.requestTimeout = 0;
    server.headersTimeout = 30_000;
    try {
      const listening = Promise.withResolvers<void>();
      server.once("error", listening.reject);
      server.listen({ port, host: this.options.host ?? "0.0.0.0" }, () => {
        server.off("error", listening.reject);
        listening.resolve();
      });
      await listening.promise;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      this.state = "error";
      this.error =
        code === "EADDRINUSE"
          ? t("remote.portInUse", { port })
          : t("remote.listenFailed", { error: errorMessage(error) });
      this.options.log?.(`Phone access could not listen on port ${port}: ${errorMessage(error)}`);
      return;
    }
    server.on("error", (error) => this.options.log?.(`Phone access: ${error.message}`));
    this.server = server;
    this.state = "listening";
    this.error = null;
    this.options.log?.(`Phone access on port ${this.listeningPort ?? port}.`);
  }

  private async stopListening(): Promise<void> {
    this.closeStreams(() => true);
    const server = this.server;
    this.server = null;
    this.state = "off";
    this.error = null;
    if (!server) return;
    const closed = Promise.withResolvers<void>();
    server.close(() => closed.resolve());
    server.closeAllConnections();
    await closed.promise;
  }

  private closeStreams(match: (stream: EventStream) => boolean): void {
    for (const stream of [...this.streams]) {
      if (!match(stream)) continue;
      this.streams.delete(stream);
      clearInterval(stream.heartbeat);
      stream.res.end();
    }
  }

  private write(stream: EventStream, chunk: string): void {
    const { res } = stream;
    if (res.destroyed || !res.writable) return;
    if (res.writableLength > MAX_STREAM_BACKLOG) {
      this.options.log?.("Phone access: dropping a device that does not read.");
      res.destroy();
      return;
    }
    res.write(chunk);
  }

  // -------------------------------------------------------------------------------------------
  // Requests
  // -------------------------------------------------------------------------------------------

  private async onRequest(req: IncomingMessage, res: ServerResponse, webDir: string) {
    applySecurityHeaders(res);
    try {
      const url = new URL(req.url ?? "/", "http://device");
      if (url.pathname.startsWith("/api/")) {
        await this.api(req, res, url.pathname);
      } else if (req.method === "GET" || req.method === "HEAD") {
        await serveStatic(req, res, webDir, url.pathname);
      } else {
        throw new HttpError(405, t("remote.forbidden"));
      }
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      this.options.log?.(`Phone access: ${errorMessage(error)}`);
      sendJson(res, 500, { error: errorMessage(error) });
    }
  }

  private device(req: IncomingMessage): StoredDevice | null {
    const device = this.store.authenticate(bearerToken(req));
    if (device) this.store.touch(device, this.now());
    return device;
  }

  private async api(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    if (!sameOrigin(req)) throw new HttpError(403, t("remote.forbidden"));
    const route = `${req.method} ${path}`;

    if (route === "GET /api/session") {
      const device = this.device(req);
      sendJson(res, 200, {
        paired: device !== null,
        deviceName: device?.name ?? null,
        appVersion: this.options.appVersion,
      });
      return;
    }
    if (route === "POST /api/pair") {
      await this.pair(req, res);
      return;
    }

    const device = this.device(req);
    if (!device) throw new HttpError(401, t("remote.notPaired"));

    switch (route) {
      case "GET /api/events":
        this.openStream(req, res, device);
        return;
      case "POST /api/command":
        await this.command(req, res);
        return;
      case "POST /api/upload":
        await this.upload(req, res);
        return;
      case "POST /api/logout":
        await this.store.removeDevice(device.id);
        this.closeStreams((stream) => stream.deviceId === device.id);
        this.changed();
        sendJson(res, 200, { ok: true });
        return;
      default:
        throw new HttpError(404, t("remote.notFound"));
    }
  }

  private async pair(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = parseJson(await readBody(req, MAX_PAIR_BYTES, t("remote.requestTooLarge"))) as {
      code?: unknown;
      name?: unknown;
    } | null;
    if (!body || typeof body.code !== "string") throw new HttpError(400, t("remote.badRequest"));
    const result = this.guard.attempt(body.code, this.now());
    switch (result.status) {
      case "ok": {
        const name = typeof body.name === "string" ? body.name : "";
        const { device, token } = await this.store.addDevice(name, this.now());
        this.options.log?.("Phone access: a device paired.");
        this.changed();
        sendJson(res, 200, { token, deviceName: device.name || t("remote.defaultDeviceName") });
        return;
      }
      case "invalid":
        throw new HttpError(400, t("remote.pairInvalid"));
      case "closed":
        throw new HttpError(400, t("remote.pairClosed"));
      case "locked":
        throw new HttpError(429, t("remote.pairLocked"));
    }
  }

  private openStream(req: IncomingMessage, res: ServerResponse, device: StoredDevice): void {
    req.socket.setKeepAlive(true);
    req.socket.setNoDelay(true);
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      // Tells buffering proxies (nginx and the like) to pass events on at once.
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");
    const stream: EventStream = {
      res,
      deviceId: device.id,
      heartbeat: setInterval(() => this.write(stream, ": ping\n\n"), HEARTBEAT_MS),
    };
    this.streams.add(stream);
    const wasConnected = [...this.streams].filter((s) => s.deviceId === device.id).length > 1;
    if (!wasConnected) this.changed();
    res.on("close", () => {
      clearInterval(stream.heartbeat);
      if (!this.streams.delete(stream)) return;
      const stillConnected = [...this.streams].some((s) => s.deviceId === device.id);
      if (!stillConnected) this.changed();
    });
  }

  private async command(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const command = parseJson(
      await readBody(req, MAX_COMMAND_BYTES, t("remote.requestTooLarge")),
    ) as AgentCommand | null;
    if (!command || typeof command !== "object" || typeof command.type !== "string")
      throw new HttpError(400, t("remote.badRequest"));
    if (!remoteMayRun(command)) throw new HttpError(403, t("remote.localOnly"));
    this.checkAttachments(command);
    try {
      const data = await this.options.handle(command);
      sendJson(res, 200, { ok: true, data: data ?? null });
    } catch (error) {
      sendJson(res, 200, { ok: false, error: errorMessage(error) });
    }
  }

  /**
   * A device can attach only what it uploaded: a path anywhere else on the computer would let it
   * send any file to the model without the agent's read tools (and their approvals) seeing it.
   */
  private checkAttachments(command: AgentCommand): void {
    if (command.type !== "prompt" && command.type !== "edit_message") return;
    const attachments: unknown = command.attachments;
    if (!Array.isArray(attachments)) throw new HttpError(400, t("remote.badRequest"));
    const uploads = resolve(this.options.uploadsDir) + sep;
    for (const attachment of attachments as Partial<Attachment>[]) {
      if (!attachment || typeof attachment !== "object")
        throw new HttpError(400, t("remote.badRequest"));
      if (attachment.path === undefined) continue;
      if (typeof attachment.path !== "string" || !resolve(attachment.path).startsWith(uploads))
        throw new HttpError(
          403,
          t("remote.attachmentNotUploaded", { name: String(attachment.name ?? "") }),
        );
    }
  }

  private async upload(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const header = req.headers["x-file-name"];
    let name = "file";
    if (typeof header === "string") {
      try {
        name = safeFileName(decodeURIComponent(header));
      } catch {
        throw new HttpError(400, t("remote.badRequest"));
      }
    }
    const type = req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() ?? "";
    const mimeType = /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : "application/octet-stream";
    const bytes = await readBody(
      req,
      MAX_UPLOAD_BYTES,
      t("remote.uploadTooLarge", { name, limit: MAX_UPLOAD_MB }),
    );
    const dir = join(this.options.uploadsDir, randomUUID());
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, name);
    await writeFile(path, bytes, { mode: 0o600 });
    const attachment: Attachment = { name, mimeType, path };
    sendJson(res, 200, attachment);
  }

  /** Removes uploads older than a day; whatever a message sent was copied into the workspace. */
  private async sweepUploads(): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(this.options.uploadsDir);
    } catch {
      return;
    }
    const cutoff = this.now() - UPLOAD_MAX_AGE_MS;
    for (const entry of entries) {
      const path = join(this.options.uploadsDir, entry);
      try {
        if ((await stat(path)).mtimeMs < cutoff) await rm(path, { recursive: true, force: true });
      } catch {
        // Gone already, or in use; the next sweep tries again.
      }
    }
  }
}
