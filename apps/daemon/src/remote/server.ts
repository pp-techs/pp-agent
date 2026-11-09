import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { basename, join, resolve, sep } from "node:path";
import { PairingGuard, translate as t, type RemoteAccessControl } from "@workspace/agent-core";
import {
  type AgentCommand,
  type AgentEvent,
  type Attachment,
  type ComputerAppAccess,
  type GatewayView,
  type McpOverview,
  type RemoteAccessState,
  type RemoteAccessStatus,
  type RemoteDevice,
  remoteMayRun,
} from "@workspace/shared";
import { AddressLockout } from "./address-lockout.ts";
import {
  appOrigin,
  applyCorsHeaders,
  applySecurityHeaders,
  bearerToken,
  HttpError,
  isCgnatAddress,
  isLoopbackHost,
  isOwnHost,
  lanUrls,
  ownAddresses,
  readBody,
  sameOrigin,
  saveBody,
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
/**
 * A device that leaves this much unread is gone or stuck; its stream is dropped. It refetches a
 * snapshot when it reconnects, so nothing is lost by dropping early.
 */
const MAX_STREAM_BACKLOG = 4 * 1024 * 1024;
/** Event streams one device may hold (a few tabs); a new one closes the oldest. */
const MAX_STREAMS_PER_DEVICE = 3;
/** Uploads one device may run at the same time. */
const MAX_UPLOADS_PER_DEVICE = 3;
/** Uploaded files are copied into the workspace when sent; leftovers go after a day. */
const UPLOAD_MAX_AGE_MS = 24 * 60 * 60_000;
const UPLOAD_SWEEP_MS = 60 * 60_000;
/**
 * The whole request (headers and body) must arrive within this; a 100 MB upload on slow Wi-Fi
 * fits. It does not limit responses, so event streams stay open.
 */
const REQUEST_TIMEOUT_MS = 10 * 60_000;

export interface RemoteServerOptions {
  /** `remote.json` (settings and paired devices). */
  file: string;
  /** Where uploads from devices wait until a message sends them. */
  uploadsDir: string;
  /** The built web app's folder, looked up each time the server starts listening. */
  webDir(): string | null;
  /** Runs a command on the agent host, as a desktop client's command would. */
  handle(command: AgentCommand): Promise<unknown>;
  /** Tells every client (the desktop window too) that Settings › Remote access changed. */
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
 * Addresses of the local network: private IPv4 ranges, link-local, and the IPv6 equivalents
 * (unique-local, link-local). Carrier-grade NAT (`100.64.0.0/10`) counts only while this computer
 * has such an address itself (it is on a tailnet): some ISPs and hotspots hand those addresses out
 * to their other customers. Loopback is not the local network: a tunnel or reverse proxy on this
 * computer (`tailscale funnel`, `cloudflared`, `ngrok`) shows up as loopback and would put the
 * pairing endpoint on the internet.
 */
export function isLocalNetworkAddress(
  address: string | undefined,
  addresses: readonly string[],
): boolean {
  if (!address) return false;
  const v4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (isIP(v4) === 4) {
    if (isCgnatAddress(v4)) return addresses.some(isCgnatAddress);
    const [a = 0, b = 0] = v4.split(".").map(Number);
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  const v6 = address.toLowerCase();
  return /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const v4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  return v4 === "::1" || (isIP(v4) === 4 && v4.startsWith("127."));
}

/** A base URL compared without case in the host or trailing slashes. */
function normalizeUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value.trim());
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch {
    return value.trim();
  }
}

/** Values of MCP `env` and `headers` (API keys, tokens) never leave the computer. */
const HIDDEN_VALUE = "••••••";

function hideValues(values: Record<string, string> | undefined) {
  return values && Object.fromEntries(Object.keys(values).map((key) => [key, HIDDEN_VALUE]));
}

/**
 * What a device receives for a command: the host's answer, without the secrets a phone has no use
 * for (it cannot edit MCP servers or pair Telegram and Zalo) and a copied token should not expose.
 */
function remoteView(command: AgentCommand, data: unknown): unknown {
  if (command.type === "get_telegram_status" || command.type === "get_zalo_status")
    return data && typeof data === "object"
      ? { ...data, pairingCode: null, pairingExpiresAt: null }
      : data;
  if (command.type !== "list_mcp_servers") return data;
  const overview = data as McpOverview;
  return {
    ...overview,
    servers: overview.servers.map((server) => ({
      ...server,
      settings: {
        ...server.settings,
        env: hideValues(server.settings.env),
        headers: hideValues(server.settings.headers),
      },
    })),
  };
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
  /** Wrong pairing codes per source address, so one client cannot lock pairing for everyone. */
  private readonly lockout = new AddressLockout();
  private readonly streams = new Set<EventStream>();
  /** Uploads running per device. */
  private readonly uploading = new Map<string, number>();
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

  /** Loads `remote.json` and starts listening when remote access was left on. */
  async start(): Promise<void> {
    await this.store.load();
    await this.sweep();
    this.sweepTimer = setInterval(() => void this.sweep(), UPLOAD_SWEEP_MS);
    this.sweepTimer.unref();
    if (this.store.enabled) await this.serialize(() => this.listen(this.store.port));
    // A window that asked before the file was read refreshes with the loaded settings and devices.
    this.changed();
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
    this.lockout.clear();
    this.changed();
    return this.status();
  }

  async forgetDevice(id: string): Promise<RemoteAccessStatus> {
    if (!(await this.store.removeDevice(id))) throw new Error(t("remote.deviceUnknown"));
    this.signedOut([id]);
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
      this.options.log?.("Remote access: the web app is not built.");
      return;
    }
    const server = createServer((req, res) => void this.onRequest(req, res, webDir));
    server.requestTimeout = REQUEST_TIMEOUT_MS;
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
      this.options.log?.(`Remote access could not listen on port ${port}: ${errorMessage(error)}`);
      return;
    }
    server.on("error", (error) => this.options.log?.(`Remote access: ${error.message}`));
    this.server = server;
    this.state = "listening";
    this.error = null;
    this.options.log?.(`Remote access on port ${this.listeningPort ?? port}.`);
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
      this.options.log?.("Remote access: dropping a device that does not read.");
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
      // Phones on the local network only: a computer with a public address must not answer the
      // internet, even for the pairing endpoint. Loopback is answered only for a loopback `Host`
      // (a browser or dev proxy on this computer); a tunnel to the internet sends its public name.
      const addresses = ownAddresses();
      const source = req.socket.remoteAddress;
      const loopback = isLoopbackAddress(source) && isLoopbackHost(req.headers.host);
      if (!loopback && !isLocalNetworkAddress(source, addresses))
        throw new HttpError(403, t("remote.forbidden"));
      // A page that rebound its own name to this address (DNS rebinding) sends that name.
      if (!isOwnHost(req.headers.host, addresses)) throw new HttpError(421, t("remote.wrongHost"));
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
      this.options.log?.(`Remote access: ${errorMessage(error)}`);
      sendJson(res, 500, { error: errorMessage(error) });
    }
  }

  private device(req: IncomingMessage): StoredDevice | null {
    const now = this.now();
    const device = this.store.authenticate(bearerToken(req), now);
    if (device) this.store.touch(device, now);
    return device;
  }

  private async api(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const app = appOrigin(req);
    if (app) applyCorsHeaders(req, res, app);
    else if (!sameOrigin(req)) throw new HttpError(403, t("remote.forbidden"));
    if (app && req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
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
        await this.command(req, res, device);
        return;
      case "POST /api/upload":
        await this.upload(req, res, device);
        return;
      case "POST /api/logout":
        await this.store.removeDevice(device.id);
        this.signedOut([device.id]);
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
    const address = req.socket.remoteAddress ?? "";
    const now = this.now();
    if (this.lockout.locked(address, now)) throw new HttpError(429, t("remote.pairLocked"));
    const result = this.guard.attempt(body.code, now);
    switch (result.status) {
      case "ok": {
        this.lockout.succeeded(address);
        const name = typeof body.name === "string" ? body.name : "";
        const { device, token, evicted } = await this.store.addDevice(name, this.now());
        this.signedOut(evicted);
        this.options.log?.("Remote access: a device paired.");
        this.changed();
        sendJson(res, 200, { token, deviceName: device.name || t("remote.defaultDeviceName") });
        return;
      }
      case "invalid":
        if (this.lockout.failed(address, now)) throw new HttpError(429, t("remote.pairLocked"));
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
    // A device holds a few streams at most (a tab each); the oldest makes way for a new one.
    const mine = [...this.streams].filter((s) => s.deviceId === device.id);
    const oldest = new Set(mine.slice(0, Math.max(0, mine.length - MAX_STREAMS_PER_DEVICE + 1)));
    if (oldest.size > 0) this.closeStreams((s) => oldest.has(s));
    const stream: EventStream = {
      res,
      deviceId: device.id,
      heartbeat: setInterval(() => this.write(stream, ": ping\n\n"), HEARTBEAT_MS),
    };
    this.streams.add(stream);
    const wasConnected = mine.length > 0;
    if (!wasConnected) this.changed();
    res.on("close", () => {
      clearInterval(stream.heartbeat);
      if (!this.streams.delete(stream)) return;
      const stillConnected = [...this.streams].some((s) => s.deviceId === device.id);
      if (!stillConnected) this.changed();
    });
  }

  /** Whether the device is still paired: it may be signed out while its request was arriving. */
  private stillPaired(device: StoredDevice): void {
    if (!this.store.devices.some((candidate) => candidate.id === device.id))
      throw new HttpError(401, t("remote.notPaired"));
  }

  private async command(
    req: IncomingMessage,
    res: ServerResponse,
    device: StoredDevice,
  ): Promise<void> {
    const command = parseJson(
      await readBody(req, MAX_COMMAND_BYTES, t("remote.requestTooLarge")),
    ) as AgentCommand | null;
    this.stillPaired(device);
    if (!command || typeof command !== "object" || typeof command.type !== "string")
      throw new HttpError(400, t("remote.badRequest"));
    if (!remoteMayRun(command)) throw new HttpError(403, t("remote.localOnly"));
    this.checkAttachments(command, device);
    await this.checkGatewayKey(command);
    await this.checkAppUnblock(command);
    try {
      const data = remoteView(command, await this.options.handle(command));
      sendJson(res, 200, { ok: true, data: data ?? null });
    } catch (error) {
      sendJson(res, 200, { ok: false, error: errorMessage(error) });
    }
  }

  /**
   * A device can attach only what it uploaded: a path anywhere else on the computer would let it
   * send any file to the model without the agent's read tools (and their approvals) seeing it.
   */
  private checkAttachments(command: AgentCommand, device: StoredDevice): void {
    if (command.type !== "prompt" && command.type !== "edit_message") return;
    const attachments: unknown = command.attachments;
    if (!Array.isArray(attachments)) throw new HttpError(400, t("remote.badRequest"));
    // Each device's uploads live in a folder of its own; another device's are not its to send.
    const uploads = resolve(this.uploadsOf(device.id)) + sep;
    for (const attachment of attachments as Partial<Attachment>[]) {
      if (!attachment || typeof attachment !== "object")
        throw new HttpError(400, t("remote.badRequest"));
      if (attachment.path === undefined) continue;
      if (typeof attachment.path !== "string" || !resolve(attachment.path).startsWith(uploads))
        throw new HttpError(
          403,
          t("remote.attachmentNotUploaded", { name: String(attachment.name ?? "") }),
        );
      // Uploads older than a day are swept; a draft kept that long must attach the file again.
      if (!existsSync(attachment.path))
        throw new HttpError(
          410,
          t("remote.attachmentExpired", { name: String(attachment.name ?? "") }),
        );
    }
  }

  /**
   * A stored gateway key goes only to the address it was saved for. From a device, sending it
   * elsewhere (a changed base URL, or a model listing against another URL) needs the key typed
   * again; otherwise a copied device token could send the key to any server. The window may still
   * fix a gateway's address without retyping its key.
   */
  private async checkGatewayKey(command: AgentCommand): Promise<void> {
    let id: string | undefined;
    let baseUrl: unknown;
    if (command.type === "save_gateway") {
      if (!command.gateway || typeof command.gateway !== "object")
        throw new HttpError(400, t("remote.badRequest"));
      if (command.gateway.apiKey !== undefined) return;
      ({ id, baseUrl } = command.gateway);
    } else if (command.type === "fetch_gateway_models") {
      // A blank key falls back to the stored one, so only a typed key skips the check. (For
      // save_gateway a blank key deletes the stored one: nothing to send.)
      if (typeof command.apiKey === "string" && command.apiKey.trim() !== "") return;
      ({ gatewayId: id, baseUrl } = command);
    } else {
      return;
    }
    if (id === undefined) return;
    const gateways = (await this.options.handle({ type: "list_gateways" })) as GatewayView[];
    const stored = gateways.find((gateway) => gateway.id === id);
    if (stored?.hasApiKey && normalizeUrl(stored.baseUrl) !== normalizeUrl(baseUrl))
      throw new HttpError(403, t("remote.gatewayKeyAgain"));
  }

  /**
   * Taking an app off the blocked list loosens what the agent may do, which only the computer may
   * do; taking one off the always-allowed list (or blocking it) is fine from a device.
   */
  private async checkAppUnblock(command: AgentCommand): Promise<void> {
    if (command.type !== "set_computer_app_access" || command.access === "blocked") return;
    const app: unknown = command.app;
    const id = app && typeof app === "object" && "id" in app ? app.id : undefined;
    if (typeof id !== "string") throw new HttpError(400, t("remote.badRequest"));
    const lists = (await this.options.handle({ type: "list_computer_apps" })) as ComputerAppAccess;
    if (lists.blocked.some((app) => app.id === id.trim()))
      throw new HttpError(403, t("remote.localOnly"));
  }

  private uploadsOf(deviceId: string): string {
    return join(this.options.uploadsDir, deviceId);
  }

  /** Ends what signed-out devices still hold: their event streams and their uploads. */
  private signedOut(deviceIds: readonly string[]): void {
    if (deviceIds.length === 0) return;
    const ids = new Set(deviceIds);
    this.closeStreams((stream) => ids.has(stream.deviceId));
    for (const id of ids)
      void rm(this.uploadsOf(id), { recursive: true, force: true }).catch(() => undefined);
  }

  private async upload(
    req: IncomingMessage,
    res: ServerResponse,
    device: StoredDevice,
  ): Promise<void> {
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
    const running = this.uploading.get(device.id) ?? 0;
    if (running >= MAX_UPLOADS_PER_DEVICE) throw new HttpError(429, t("remote.tooManyUploads"));
    this.uploading.set(device.id, running + 1);
    const dir = join(this.uploadsOf(device.id), randomUUID());
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const path = join(dir, name);
      await saveBody(
        req,
        path,
        MAX_UPLOAD_BYTES,
        t("remote.uploadTooLarge", { name, limit: MAX_UPLOAD_MB }),
      );
      this.stillPaired(device);
      const attachment: Attachment = { name, mimeType, path };
      sendJson(res, 200, attachment);
    } catch (error) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    } finally {
      const left = (this.uploading.get(device.id) ?? 1) - 1;
      if (left > 0) this.uploading.set(device.id, left);
      else this.uploading.delete(device.id);
    }
  }

  /** Hourly: signs out devices unused for too long, then removes old uploads. */
  private async sweep(): Promise<void> {
    try {
      const idle = await this.store.removeIdle(this.now());
      if (idle.length > 0) {
        this.options.log?.("Remote access: signed out devices unused for 30 days.");
        this.signedOut(idle);
        this.changed();
      }
    } catch (error) {
      this.options.log?.(`Remote access: ${errorMessage(error)}`);
    }
    await this.sweepUploads();
  }

  /**
   * Removes uploads older than a day (`<uploads>/<device>/<upload>/`); whatever a message sent was
   * copied into the workspace. Folders of devices that are no longer paired go entirely.
   */
  private async sweepUploads(): Promise<void> {
    const cutoff = this.now() - UPLOAD_MAX_AGE_MS;
    const paired = new Set(this.store.devices.map((device) => device.id));
    const list = (dir: string) => readdir(dir).catch(() => [] as string[]);
    for (const deviceId of await list(this.options.uploadsDir)) {
      const deviceDir = join(this.options.uploadsDir, deviceId);
      if (!paired.has(deviceId)) {
        await rm(deviceDir, { recursive: true, force: true }).catch(() => undefined);
        continue;
      }
      for (const entry of await list(deviceDir)) {
        const path = join(deviceDir, entry);
        try {
          if ((await stat(path)).mtimeMs < cutoff) await rm(path, { recursive: true, force: true });
        } catch {
          // Gone already, or in use; the next sweep tries again.
        }
      }
    }
  }
}
