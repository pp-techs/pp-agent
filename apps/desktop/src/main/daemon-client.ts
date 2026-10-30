import { randomBytes } from "node:crypto";
import { proof, validNonce, validateUnixEndpoint, verifyProof } from "@workspace/daemon/auth";
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { app } from "electron";
import { encodeFrame, FrameDecoder } from "@workspace/daemon/framing";
import { type DaemonPaths, resolveDaemonPaths } from "@workspace/daemon/paths";
import {
  type AgentCommand,
  type AgentEvent,
  type BrowserRequest,
  type BrowserResult,
  type ComputerRequest,
  type ComputerResult,
  type ClientFrame,
  DAEMON_PROTOCOL,
  type DaemonFrame,
  type StoredCredential,
} from "@workspace/shared";
import { translator } from "./i18n.ts";

const RETRY_DELAY_MS = 1_000;
const DIAL_INTERVAL_MS = 150;
/** How long a freshly spawned daemon gets to start listening. */
const START_TIMEOUT_MS = 20_000;
const HELLO_TIMEOUT_MS = 5_000;
const REPLACE_TIMEOUT_MS = 5_000;
/** Commands issued while the daemon is (re)starting wait this long for it. */
const COMMAND_WAIT_MS = 20_000;
/** An out-of-date daemon is replaced this many times before it is accepted as it is. */
const MAX_REPLACEMENTS = 2;

type Hello = Extract<DaemonFrame, { kind: "hello_ok" }>;

interface Connection {
  socket: Socket;
  decoder: FrameDecoder;
  hello: PromiseWithResolvers<Hello>;
  closed: PromiseWithResolvers<void>;
  /** Frames that arrived with the handshake reply, delivered once the connection is adopted. */
  early: DaemonFrame[];
  token: string;
  nonce: string;
  challenge: string | null;
}

export interface DaemonClientOptions {
  /** The app's data folder (`userData`); the daemon uses it as its home. */
  home: string;
  /** `daemon.mjs`, started with this process's binary in Node mode. */
  daemonScript: string;
  resourcesDir: string;
  appVersion: string;
  onEvent(event: AgentEvent): void;
  onOpenUrl(url: string): void;
  /** Runs one call of the agent's browser tool in this window's side panel browser. */
  onBrowserRequest(request: BrowserRequest): Promise<BrowserResult>;
  /** Runs one call of the agent's computer tool through this window's cua-driver. */
  onComputerRequest(request: ComputerRequest, signal: AbortSignal): Promise<ComputerResult>;
  /** The connection broke after being up. Pending commands were already rejected. */
  onLost(): void;
  /** The daemon could not be started or reached; the client keeps trying. */
  onStartFailed(error: Error): void;
  /** The handshake finished (on the first connection and after every reconnection). */
  onConnected(): void;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isNotListening(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ECONNREFUSED" || code === "ENOTSOCK";
}

async function delay(ms: number): Promise<void> {
  const done = Promise.withResolvers<void>();
  setTimeout(done.resolve, ms);
  await done.promise;
}

/**
 * The window's connection to pp-agentd. Starts the daemon when nothing listens, replaces one of
 * another version, and reconnects when the link drops.
 */
export class DaemonClient {
  private readonly paths: DaemonPaths;
  private conn: Connection | null = null;
  private ready = Promise.withResolvers<Connection>();
  private nextId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (data: unknown) => void; reject: (error: Error) => void }
  >();
  private quitting = false;
  private spawnedPid: number | null = null;
  private spawnError: Error | null = null;
  private ownsDaemon = false;
  /** Last value given to `setBrowserAvailable`, sent again after every (re)connection. */
  private browserAvailable = false;
  /** Last value given to `setComputerAvailable`, likewise. */
  private computerAvailable = false;

  constructor(private readonly options: DaemonClientOptions) {
    this.paths = resolveDaemonPaths({ ...process.env, PP_AGENT_HOME: options.home });
    // Nobody waits on it until a command arrives.
    this.ready.promise.catch(() => undefined);
  }

  /** Whether this app started the running daemon (and so stops it on quit). */
  get startedByThisApp(): boolean {
    return this.ownsDaemon;
  }

  start(): void {
    void this.supervise();
  }

  command(command: AgentCommand): Promise<unknown> {
    return this.call((id) => ({ kind: "command", id, command }));
  }

  /** Hands the old desktop vault's credentials to the daemon. */
  async importCredentials(entries: Record<string, StoredCredential>): Promise<void> {
    await this.call((id) => ({ kind: "vault_import", id, entries }));
  }

  /** Tells the daemon whether the agent's browser tool can run here (a window is open). */
  setBrowserAvailable(available: boolean): void {
    this.browserAvailable = available;
    this.conn?.socket.write(
      encodeFrame({ kind: "browser_available", available } satisfies ClientFrame),
    );
  }

  /** Tells the daemon whether the agent's computer tool can run here (a window and cua-driver). */
  setComputerAvailable(available: boolean): void {
    this.computerAvailable = available;
    this.conn?.socket.write(
      encodeFrame({ kind: "computer_available", available } satisfies ClientFrame),
    );
  }

  /** Quitting: stops the daemon this app started, leaves any other running. */
  dispose(): void {
    this.quitting = true;
    const { conn } = this;
    if (conn) {
      if (this.ownsDaemon)
        conn.socket.write(encodeFrame({ kind: "shutdown" } satisfies ClientFrame));
      conn.socket.end();
    }
    this.rejectPending();
  }

  private async call(build: (id: number) => ClientFrame): Promise<unknown> {
    const conn = await this.waitConnected();
    this.nextId += 1;
    const id = this.nextId;
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    this.pending.set(id, { resolve, reject });
    if (conn.socket.destroyed) {
      this.pending.delete(id);
      reject(new Error(translator()("app.stoppedUnexpectedly")));
    } else {
      conn.socket.write(encodeFrame(build(id)));
    }
    return promise;
  }

  private async waitConnected(): Promise<Connection> {
    if (this.conn) return this.conn;
    const timedOut = Promise.withResolvers<never>();
    const timer = setTimeout(
      () => timedOut.reject(new Error(translator()("app.notRunning"))),
      COMMAND_WAIT_MS,
    );
    try {
      return await Promise.race([this.ready.promise, timedOut.promise]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async supervise(): Promise<void> {
    let reported = false;
    while (!this.quitting) {
      try {
        const conn = await this.establish();
        if (!conn) return;
        reported = false;
        this.options.onConnected();
        await conn.closed.promise;
        if (!this.quitting) this.options.onLost();
      } catch (error) {
        if (!reported && !this.quitting) this.options.onStartFailed(toError(error));
        reported = true;
      }
      if (!this.quitting) await delay(RETRY_DELAY_MS);
    }
  }

  /** Connects to the daemon, starting or replacing it as needed. Null when the app is quitting. */
  private async establish(): Promise<Connection | null> {
    const deadline = Date.now() + START_TIMEOUT_MS;
    let spawned = false;
    let replacements = 0;
    this.spawnError = null;
    while (!this.quitting) {
      const conn = await this.dial();
      if (conn) {
        const hello = await this.greet(conn);
        const current =
          hello.protocol === DAEMON_PROTOCOL && hello.appVersion === this.options.appVersion;
        if (!current && replacements < MAX_REPLACEMENTS) {
          // An update replaced the app while an older daemon kept running.
          replacements += 1;
          conn.socket.write(encodeFrame({ kind: "shutdown" } satisfies ClientFrame));
          await this.closeWithin(conn, REPLACE_TIMEOUT_MS);
          spawned = false;
          continue;
        }
        if (!current) {
          console.warn(
            `pp-agentd ${hello.appVersion} (protocol ${hello.protocol}) could not be replaced.`,
          );
        }
        this.ownsDaemon = hello.pid === this.spawnedPid;
        this.adopt(conn);
        return conn;
      }
      if (!spawned) {
        this.spawnDaemon();
        spawned = true;
      }
      if (this.spawnError) throw this.spawnError;
      if (Date.now() > deadline) {
        throw new Error(translator()("app.couldNotStart", { error: "pp-agentd does not answer." }));
      }
      await delay(DIAL_INTERVAL_MS);
    }
    return null;
  }

  /** Opens a socket to the daemon, or null when none is listening. */
  private async dial(): Promise<Connection | null> {
    let token: string;
    try {
      token = (await readFile(this.paths.tokenFile, "utf8")).trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (process.platform !== "win32") {
      try {
        await validateUnixEndpoint(this.paths.endpoint);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    }
    if (!validNonce(token)) throw new Error("The daemon token is invalid.");
    const socket = connect(this.paths.endpoint);
    const opened = Promise.withResolvers<void>();
    socket.once("connect", opened.resolve);
    socket.once("error", opened.reject);
    try {
      await opened.promise;
    } catch (error) {
      socket.destroy();
      if (isNotListening(error)) return null;
      throw error;
    }
    socket.off("error", opened.reject);

    const conn: Connection = {
      socket,
      decoder: new FrameDecoder(),
      hello: Promise.withResolvers<Hello>(),
      closed: Promise.withResolvers<void>(),
      early: [],
      token,
      nonce: randomBytes(32).toString("hex"),
      challenge: null,
    };
    // A failed handshake is reported by `greet`; this only keeps the rejection from being unhandled.
    conn.hello.promise.catch(() => undefined);
    socket.on("data", (chunk) => {
      let frames: unknown[];
      try {
        frames = conn.decoder.push(chunk);
      } catch (error) {
        console.error("The daemon sent an unreadable frame:", error);
        socket.destroy();
        return;
      }
      for (const frame of frames) this.receive(conn, frame as DaemonFrame);
    });
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      conn.hello.reject(new Error(translator()("app.stoppedUnexpectedly")));
      if (this.conn === conn) this.lose();
      conn.closed.resolve();
    });
    return conn;
  }

  private async greet(conn: Connection): Promise<Hello> {
    const timedOut = Promise.withResolvers<never>();
    const timer = setTimeout(
      () =>
        timedOut.reject(
          new Error(
            "pp-agentd did not answer the handshake. Restart an older daemon before reconnecting.",
          ),
        ),
      HELLO_TIMEOUT_MS,
    );
    try {
      const hello = await Promise.race([conn.hello.promise, timedOut.promise]);
      if (
        conn.challenge === null ||
        typeof hello.protocol !== "number" ||
        typeof hello.appVersion !== "string" ||
        !Number.isSafeInteger(hello.pid) ||
        hello.pid <= 0 ||
        !verifyProof(
          hello.proof,
          proof(
            conn.token,
            "daemon",
            conn.challenge,
            conn.nonce,
            hello.protocol,
            hello.appVersion,
            hello.pid,
          ),
        )
      )
        throw new Error(
          "The daemon authentication proof is invalid. Restart an older daemon before reconnecting.",
        );
      conn.token = "";
      return hello;
    } catch (error) {
      conn.socket.destroy();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async closeWithin(conn: Connection, ms: number): Promise<void> {
    const timer = setTimeout(() => conn.socket.destroy(), ms);
    try {
      await conn.closed.promise;
    } finally {
      clearTimeout(timer);
    }
  }

  private adopt(conn: Connection): void {
    this.conn = conn;
    this.ready.resolve(conn);
    // A new daemon (or a reconnection) does not know whether this app has a window.
    conn.socket.write(
      encodeFrame({
        kind: "browser_available",
        available: this.browserAvailable,
      } satisfies ClientFrame),
    );
    conn.socket.write(
      encodeFrame({
        kind: "computer_available",
        available: this.computerAvailable,
      } satisfies ClientFrame),
    );
    for (const frame of conn.early.splice(0)) this.receive(conn, frame);
  }

  /** The adopted connection is gone: fail what waits on it and let commands wait for the next. */
  private lose(): void {
    this.conn = null;
    this.ownsDaemon = false;
    this.ready = Promise.withResolvers<Connection>();
    this.ready.promise.catch(() => undefined);
    this.rejectPending();
  }

  private rejectPending(): void {
    const message = translator()("app.stoppedUnexpectedly");
    for (const request of this.pending.values()) request.reject(new Error(message));
    this.pending.clear();
  }

  private receive(conn: Connection, frame: DaemonFrame): void {
    switch (frame.kind) {
      case "challenge":
        if (conn.challenge !== null || !validNonce(frame.nonce)) {
          conn.hello.reject(new Error("Invalid daemon challenge."));
          conn.socket.destroy();
          return;
        }
        conn.challenge = frame.nonce;
        conn.socket.write(
          encodeFrame({
            kind: "hello",
            protocol: DAEMON_PROTOCOL,
            appVersion: this.options.appVersion,
            nonce: conn.nonce,
            proof: proof(
              conn.token,
              "client",
              frame.nonce,
              conn.nonce,
              DAEMON_PROTOCOL,
              this.options.appVersion,
            ),
          } satisfies ClientFrame),
        );
        return;
      case "hello_ok":
        conn.hello.resolve(frame);
        return;
      case "hello_error":
        conn.hello.reject(new Error(frame.error));
        return;
    }
    if (this.conn !== conn) {
      conn.early.push(frame);
      return;
    }
    switch (frame.kind) {
      case "event":
        this.options.onEvent(frame.event);
        return;
      case "open_url":
        this.options.onOpenUrl(frame.url);
        return;
      case "browser_request": {
        const { id } = frame;
        const reply = (response: ClientFrame) => {
          if (!conn.socket.destroyed) conn.socket.write(encodeFrame(response));
        };
        this.options.onBrowserRequest(frame.request).then(
          (result) => reply({ kind: "browser_response", id, ok: true, result }),
          (error: unknown) =>
            reply({
              kind: "browser_response",
              id,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
        );
        return;
      }
      case "computer_request": {
        const { id } = frame;
        const reply = (response: ClientFrame) => {
          if (!conn.socket.destroyed) conn.socket.write(encodeFrame(response));
        };
        // A step still running when the connection drops has nobody to answer; stop it.
        const controller = new AbortController();
        const onClose = () => controller.abort();
        conn.socket.once("close", onClose);
        this.options
          .onComputerRequest(frame.request, controller.signal)
          .then(
            (result) => reply({ kind: "computer_response", id, ok: true, result }),
            (error: unknown) =>
              reply({
                kind: "computer_response",
                id,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              }),
          )
          .finally(() => conn.socket.off("close", onClose));
        return;
      }
      case "result": {
        const request = this.pending.get(frame.id);
        if (!request) return;
        this.pending.delete(frame.id);
        if (frame.ok) request.resolve(frame.data);
        else request.reject(new Error(frame.error));
      }
    }
  }

  private spawnDaemon(): void {
    mkdirSync(dirname(this.paths.logFile), { recursive: true });
    const log = openSync(this.paths.logFile, "a");
    try {
      const child = spawn(process.execPath, [this.options.daemonScript, "run"], {
        detached: true,
        windowsHide: true,
        stdio: ["ignore", log, log],
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          PP_AGENT_HOME: this.options.home,
          // Electron resolves the real Documents folder (Windows may redirect it); the daemon cannot.
          PP_AGENT_WORKSPACE: join(app.getPath("documents"), "PP Agent"),
          PP_AGENT_RESOURCES: this.options.resourcesDir,
          PP_AGENT_VERSION: this.options.appVersion,
        },
      });
      child.on("error", (error) => {
        this.spawnError = new Error(translator()("app.couldNotStart", { error: error.message }));
      });
      child.unref();
      this.spawnedPid = child.pid ?? null;
    } finally {
      closeSync(log);
    }
  }
}
