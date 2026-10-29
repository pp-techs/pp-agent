import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import type { BrowserBridge, HostOutput } from "@workspace/agent-core";
import {
  type AgentCommand,
  type BrowserRequest,
  type BrowserResult,
  type ClientFrame,
  DAEMON_PROTOCOL,
  type DaemonFrame,
  type StoredCredential,
} from "@workspace/shared";
import { encodeFrame, FrameDecoder, FrameError, MAX_FRAME_BYTES } from "./framing.ts";

import { proof, validNonce, validateSocketDirectory, verifyProof } from "./auth.ts";
import { acquireEndpointLock } from "./endpoint-lock.ts";
import { restrictWindowsPipeAccess } from "./windows-pipe.ts";

const HELLO_TIMEOUT_MS = 5_000;
const CLOSE_GRACE_MS = 1_000;
/** A client that lets this much pile up unread is gone or stuck; it is dropped, not waited for. */
const MAX_BACKLOG_BYTES = 2 * MAX_FRAME_BYTES;

/** What the server needs from the agent host; `AgentHost` satisfies it. */
export interface DaemonHost {
  handle(command: AgentCommand): Promise<unknown>;
  importCredentials(entries: Record<string, StoredCredential>): Promise<void>;
}

export interface DaemonServerOptions {
  /** Unix socket path, or a named pipe name on Windows. */
  endpoint: string;
  /** Shared secret used for mutual HMAC authentication; never sent on the socket. */
  token: string;
  appVersion: string;
  /** A client asked the daemon to exit. */
  onShutdown(): void;
  log?(message: string): void;
  helloTimeoutMs?: number;
  maxFrameBytes?: number;
}

export type ListenResult = "listening" | "already-running";

interface Client {
  socket: Socket;
  decoder: FrameDecoder;
  authenticated: boolean;
  nonce: string;
  helloTimer: NodeJS.Timeout | null;
  /** The client has a window whose browser can run the agent's browser tool. */
  browser: boolean;
}

interface PendingBrowserRequest {
  client: Client;
  resolve(result: BrowserResult): void;
  reject(error: Error): void;
}

/** A browser step may load a slow page; past this the model hears it timed out. */
const BROWSER_TIMEOUT_MS = 90_000;

/** Reads the token file, creating it (mode 0600) when missing or malformed. */
export async function ensureToken(file: string): Promise<string> {
  try {
    const existing = (await readFile(file, "utf8")).trim();
    if (/^[0-9a-f]{64}$/.test(existing)) return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const token = randomBytes(32).toString("hex");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${token}\n`, { mode: 0o600 });
  // `mode` only applies when the file is created.
  await chmod(file, 0o600).catch(() => undefined);
  return token;
}

/** Whether something accepts connections at the endpoint. */
async function answers(endpoint: string): Promise<boolean> {
  const result = Promise.withResolvers<boolean>();
  const probe = connect(endpoint);
  probe.once("connect", () => result.resolve(true));
  probe.once("error", (error: NodeJS.ErrnoException) => {
    // ENOTSOCK: a plain file is left where the socket should be.
    const idle = ["ENOENT", "ECONNREFUSED", "ENOTSOCK"].includes(error.code ?? "");
    if (idle) result.resolve(false);
    else result.reject(error);
  });
  try {
    return await result.promise;
  } finally {
    probe.destroy();
  }
}

/**
 * The daemon's local socket. Clients authenticate with `hello`; afterwards they send commands and
 * receive the host's events. Every authenticated client sees every event.
 */
export class DaemonServer {
  /** Give this to the host: what it emits goes to every authenticated client. */
  readonly output: HostOutput = {
    emit: (event) => this.broadcast({ kind: "event", event }),
    openUrl: (url) => this.broadcast({ kind: "open_url", url }),
  };

  /**
   * Give this to the host as well: the agent's browser tool runs in the side panel browser of the
   * client that offered it most recently.
   */
  readonly browser: BrowserBridge = {
    available: () => this.browserClient() !== null,
    request: (request, signal) => this.requestBrowser(request, signal),
  };

  private server: Server | null = null;
  private readonly browserRequests = new Map<number, PendingBrowserRequest>();
  private nextBrowserRequest = 1;
  private releaseLock: (() => Promise<void>) | null = null;
  /** Settles once the host is attached; commands that arrive while the host starts wait for it. */
  private hostReady = Promise.withResolvers<DaemonHost>();
  private readonly clients = new Set<Client>();
  private readonly options: DaemonServerOptions;

  constructor(options: DaemonServerOptions) {
    this.options = options;
  }

  get clientCount(): number {
    return [...this.clients].filter((client) => client.authenticated).length;
  }

  /** Starts accepting clients. Resolves `already-running` when another daemon owns the endpoint. */
  async listen(): Promise<ListenResult> {
    const { endpoint } = this.options;
    const isPipe = process.platform === "win32";
    if (!isPipe) {
      await this.prepareSocketDir(dirname(endpoint));
      this.releaseLock = await acquireEndpointLock(`${endpoint}.lock`);
      if (!this.releaseLock) return "already-running";
    }
    try {
      return await this.listenLocked(endpoint, isPipe);
    } finally {
      if (!this.server) {
        await this.releaseLock?.();
        this.releaseLock = null;
      }
    }
  }

  private async listenLocked(endpoint: string, isPipe: boolean): Promise<ListenResult> {
    if (await answers(endpoint)) return "already-running";
    if (isPipe) await restrictWindowsPipeAccess();
    // Nothing answers: a socket file left by a daemon that died.
    if (!isPipe) await unlink(endpoint).catch(() => undefined);

    const server = createServer((socket) => this.accept(socket));
    try {
      const listening = Promise.withResolvers<void>();
      server.once("error", listening.reject);
      const mask = !isPipe ? process.umask(0o077) : null;
      try {
        server.listen(endpoint, () => {
          server.off("error", listening.reject);
          listening.resolve();
        });
      } finally {
        if (mask !== null) process.umask(mask);
      }
      await listening.promise;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") return "already-running";
      throw error;
    }
    if (!isPipe) {
      try {
        await chmod(endpoint, 0o600);
      } catch (error) {
        server.close();
        throw error;
      }
    }
    server.on("error", (error) => this.options.log?.(`Server error: ${error.message}`));
    this.server = server;
    return "listening";
  }

  /** Commands that arrived before this call are answered now. */
  attach(host: DaemonHost): void {
    this.hostReady.resolve(host);
  }

  /** Stops listening, disconnects every client, and removes the socket file. */
  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.hostReady.promise.catch(() => undefined);
    this.hostReady.reject(new Error("The daemon is shutting down."));
    for (const client of this.clients) this.drop(client, CLOSE_GRACE_MS);
    if (!server) return;
    const closed = Promise.withResolvers<void>();
    server.close(() => closed.resolve());
    await closed.promise;
    // Closing a Unix server removes its socket file; this covers a socket that was replaced.
    if (process.platform !== "win32") await unlink(this.options.endpoint).catch(() => undefined);
    await this.releaseLock?.();
    this.releaseLock = null;
  }

  private async prepareSocketDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const stats = await lstat(dir);
    if (stats.isDirectory() && stats.uid === process.getuid?.() && (stats.mode & 0o077) !== 0) {
      await chmod(dir, 0o700);
    }
    await validateSocketDirectory(dir);
  }

  private accept(socket: Socket): void {
    const client: Client = {
      socket,
      decoder: new FrameDecoder(this.options.maxFrameBytes),
      authenticated: false,
      nonce: randomBytes(32).toString("hex"),
      helloTimer: null,
      browser: false,
    };
    this.clients.add(client);
    this.send(client, { kind: "challenge", nonce: client.nonce });
    client.helloTimer = setTimeout(() => {
      this.options.log?.("Closing a client that sent no hello.");
      socket.destroy();
    }, this.options.helloTimeoutMs ?? HELLO_TIMEOUT_MS);
    socket.on("data", (chunk: Buffer) => this.receive(client, chunk));
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      clearTimeout(client.helloTimer ?? undefined);
      this.clients.delete(client);
      for (const [id, pending] of this.browserRequests) {
        if (pending.client !== client) continue;
        this.browserRequests.delete(id);
        pending.reject(new Error("The PP Agent window closed before the browser step finished."));
      }
    });
  }

  private receive(client: Client, chunk: Buffer): void {
    let frames: unknown[];
    try {
      frames = client.decoder.push(chunk);
    } catch (error) {
      if (!(error instanceof FrameError)) throw error;
      this.options.log?.(`Dropping a client: ${error.message}`);
      this.reject(client, error.message);
      return;
    }
    for (const frame of frames) {
      if (client.socket.destroyed) return;
      this.dispatch(client, frame);
    }
  }

  private dispatch(client: Client, value: unknown): void {
    const frame = value as Partial<ClientFrame> | null;
    if (!frame || typeof frame !== "object" || typeof frame.kind !== "string") {
      this.reject(client, "Malformed frame.");
      return;
    }
    if (!client.authenticated) {
      if (frame.kind !== "hello") {
        this.reject(client, "The first frame must be hello.");
        return;
      }
      this.hello(client, frame as Extract<ClientFrame, { kind: "hello" }>);
      return;
    }
    switch (frame.kind) {
      case "command": {
        const { id, command } = frame as Extract<ClientFrame, { kind: "command" }>;
        this.run(client, id, (host) => host.handle(command));
        return;
      }
      case "vault_import": {
        const { id, entries } = frame as Extract<ClientFrame, { kind: "vault_import" }>;
        this.run(client, id, async (host) => {
          await host.importCredentials(entries);
          return null;
        });
        return;
      }
      case "shutdown":
        this.options.log?.("A client asked the daemon to shut down.");
        this.options.onShutdown();
        return;
      case "browser_available": {
        const { available } = frame as Extract<ClientFrame, { kind: "browser_available" }>;
        client.browser = available === true;
        // The newest window is the one the person looks at.
        if (client.browser) {
          this.clients.delete(client);
          this.clients.add(client);
        }
        return;
      }
      case "browser_response": {
        const response = frame as Extract<ClientFrame, { kind: "browser_response" }>;
        const pending = this.browserRequests.get(response.id);
        if (!pending || pending.client !== client) return;
        this.browserRequests.delete(response.id);
        if (response.ok) pending.resolve(response.result);
        else pending.reject(new Error(String(response.error)));
        return;
      }
      default:
        // Includes a repeated hello; a client that does this is confused, not hostile.
        this.send(client, { kind: "hello_error", error: `Unexpected frame: ${frame.kind}.` });
    }
  }

  /**
   * A wrong protocol number still gets `hello_ok` with the daemon's own, so a newer app can see
   * the mismatch and ask this daemon to shut down. Only a bad authentication proof is turned away.
   */
  private hello(client: Client, frame: Extract<ClientFrame, { kind: "hello" }>): void {
    if (
      !validNonce(frame.nonce) ||
      typeof frame.protocol !== "number" ||
      typeof frame.appVersion !== "string" ||
      !verifyProof(
        frame.proof,
        proof(
          this.options.token,
          "client",
          client.nonce,
          frame.nonce,
          frame.protocol,
          frame.appVersion,
        ),
      )
    ) {
      this.reject(client, "Invalid authentication proof.");
      return;
    }
    clearTimeout(client.helloTimer ?? undefined);
    client.helloTimer = null;
    client.authenticated = true;
    this.send(client, {
      kind: "hello_ok",
      protocol: DAEMON_PROTOCOL,
      appVersion: this.options.appVersion,
      pid: process.pid,
      proof: proof(
        this.options.token,
        "daemon",
        client.nonce,
        frame.nonce,
        DAEMON_PROTOCOL,
        this.options.appVersion,
        process.pid,
      ),
    });
  }

  private run(client: Client, id: number, task: (host: DaemonHost) => Promise<unknown>): void {
    if (typeof id !== "number") {
      this.send(client, { kind: "result", id, ok: false, error: "A command needs a numeric id." });
      return;
    }
    this.hostReady.promise.then(task).then(
      (data) => this.send(client, { kind: "result", id, ok: true, data: data ?? null }),
      (error: unknown) =>
        this.send(client, {
          kind: "result",
          id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
  }

  private reject(client: Client, error: string): void {
    this.send(client, { kind: "hello_error", error });
    this.drop(client, CLOSE_GRACE_MS);
  }

  /** Ends the connection after queued frames flush; destroys it if the peer does not read them. */
  private drop(client: Client, graceMs: number): void {
    const { socket } = client;
    if (socket.destroyed) return;
    socket.end();
    const timer = setTimeout(() => socket.destroy(), graceMs);
    timer.unref();
    socket.once("close", () => clearTimeout(timer));
  }

  private send(client: Client, frame: DaemonFrame): void {
    const { socket } = client;
    if (socket.destroyed || !socket.writable) return;
    if (socket.writableLength > MAX_BACKLOG_BYTES) {
      this.options.log?.("Dropping a client that does not read.");
      socket.destroy();
      return;
    }
    socket.write(encodeFrame(frame));
  }

  /** The last client in connection order that offered its browser. */
  private browserClient(): Client | null {
    let found: Client | null = null;
    for (const client of this.clients) {
      if (client.authenticated && client.browser && !client.socket.destroyed) found = client;
    }
    return found;
  }

  private requestBrowser(request: BrowserRequest, signal?: AbortSignal): Promise<BrowserResult> {
    const client = this.browserClient();
    if (!client)
      return Promise.reject(
        new Error(
          "The browser is available only while the PP Agent window is open. Ask the user to open PP Agent and try again.",
        ),
      );
    const id = this.nextBrowserRequest++;
    const result = Promise.withResolvers<BrowserResult>();
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const timer = setTimeout(() => {
      this.browserRequests.delete(id);
      result.reject(new Error("The browser step timed out."));
    }, BROWSER_TIMEOUT_MS);
    const onAbort = () => {
      this.browserRequests.delete(id);
      result.reject(new Error("The browser step was stopped."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    this.browserRequests.set(id, { client, resolve: result.resolve, reject: result.reject });
    this.send(client, { kind: "browser_request", id, request });
    return result.promise.finally(finish);
  }

  private broadcast(frame: DaemonFrame): void {
    if (this.clients.size === 0) return;
    const line = encodeFrame(frame);
    for (const client of this.clients) {
      if (!client.authenticated) continue;
      const { socket } = client;
      if (socket.destroyed || !socket.writable) continue;
      if (socket.writableLength > MAX_BACKLOG_BYTES) {
        this.options.log?.("Dropping a client that does not read.");
        socket.destroy();
        continue;
      }
      socket.write(line);
    }
  }
}
