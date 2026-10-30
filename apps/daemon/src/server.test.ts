import { randomBytes } from "node:crypto";
import { proof } from "./auth.ts";
import { chmod, mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAEMON_PROTOCOL, type AgentCommand, type DaemonFrame } from "@workspace/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { encodeFrame, FrameDecoder } from "./framing.ts";
import { endpointFor } from "./paths.ts";
import { DaemonServer, ensureToken, type DaemonHost } from "./server.ts";

const TOKEN = "a".repeat(64);

class FakeHost implements DaemonHost {
  readonly commands: AgentCommand[] = [];
  readonly imported: Record<string, unknown>[] = [];

  async handle(command: AgentCommand): Promise<unknown> {
    this.commands.push(command);
    if (command.type === "get_snapshot") return { status: "idle" };
    throw new Error("boom");
  }

  async importCredentials(entries: Record<string, never>): Promise<void> {
    this.imported.push(entries);
  }
}

/** A test client that queues the frames it receives. */
class TestClient {
  readonly frames: DaemonFrame[] = [];
  challenge = "";
  nonce = "";
  private readonly waiting: ((frame: DaemonFrame) => void)[] = [];
  readonly closed = Promise.withResolvers<void>();
  private readonly decoder = new FrameDecoder();

  private constructor(readonly socket: Socket) {
    socket.on("data", (chunk) => {
      for (const frame of this.decoder.push(chunk) as DaemonFrame[]) {
        const waiter = this.waiting.shift();
        if (waiter) waiter(frame);
        else this.frames.push(frame);
      }
    });
    socket.on("close", () => this.closed.resolve());
    socket.on("error", () => undefined);
  }

  static async open(endpoint: string): Promise<TestClient> {
    const socket = connect(endpoint);
    const opened = Promise.withResolvers<void>();
    socket.once("connect", () => opened.resolve());
    socket.once("error", opened.reject);
    await opened.promise;
    const client = new TestClient(socket);
    const challenge = await client.next();
    if (challenge.kind !== "challenge") throw new Error("Expected server challenge");
    client.challenge = challenge.nonce;
    return client;
  }

  send(frame: unknown): void {
    this.socket.write(encodeFrame(frame));
  }

  next(): Promise<DaemonFrame> {
    const queued = this.frames.shift();
    if (queued) return Promise.resolve(queued);
    const { promise, resolve } = Promise.withResolvers<DaemonFrame>();
    this.waiting.push(resolve);
    return promise;
  }

  async hello(token = TOKEN, protocol = DAEMON_PROTOCOL): Promise<DaemonFrame> {
    this.nonce = randomBytes(32).toString("hex");
    this.send({
      kind: "hello",
      protocol,
      nonce: this.nonce,
      proof: proof(token, "client", this.challenge, this.nonce, protocol, "1.0.0"),
      appVersion: "1.0.0",
    });
    return this.next();
  }

  close(): void {
    this.socket.destroy();
  }
}

let dir: string;
let endpoint: string;
const servers: DaemonServer[] = [];
const clients: TestClient[] = [];

function createServer(options: { onShutdown?: () => void; helloTimeoutMs?: number } = {}) {
  const server = new DaemonServer({
    endpoint,
    token: TOKEN,
    appVersion: "1.2.3",
    onShutdown: options.onShutdown ?? (() => undefined),
    ...(options.helloTimeoutMs ? { helloTimeoutMs: options.helloTimeoutMs } : {}),
  });
  servers.push(server);
  return server;
}

async function openClient(): Promise<TestClient> {
  const client = await TestClient.open(endpoint);
  clients.push(client);
  return client;
}

async function startServer(host = new FakeHost(), options = {}) {
  const server = createServer(options);
  expect(await server.listen()).toBe("listening");
  server.attach(host);
  return { server, host };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pp-agentd-"));
  endpoint =
    process.platform === "win32"
      ? `\\\\.\\pipe\\pp-agentd-test-${Date.now()}`
      : join(dir, "agentd.sock");
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const server of servers.splice(0)) await server.close();
  await rm(dir, { recursive: true, force: true });
});

describe("DaemonServer", () => {
  it("allows exactly one concurrent listener", async () => {
    const contenders = Array.from({ length: 12 }, () => createServer());
    const results = await Promise.all(contenders.map((server) => server.listen()));
    expect(results.filter((result) => result === "listening")).toHaveLength(1);
    const client = await openClient();
    expect((await client.hello()).kind).toBe("hello_ok");
  });

  it("rejects a client proof replayed on a new connection", async () => {
    await startServer();
    const first = await openClient();
    await first.hello();
    const second = await openClient();
    second.send({
      kind: "hello",
      protocol: DAEMON_PROTOCOL,
      appVersion: "1.0.0",
      nonce: first.nonce,
      proof: proof(TOKEN, "client", first.challenge, first.nonce, DAEMON_PROTOCOL, "1.0.0"),
    });
    expect((await second.next()).kind).toBe("hello_error");
  });

  it("answers hello with the protocol, version and pid", async () => {
    await startServer();
    const client = await openClient();
    expect(await client.hello()).toEqual({
      kind: "hello_ok",
      protocol: DAEMON_PROTOCOL,
      appVersion: "1.2.3",
      pid: process.pid,
      proof: proof(
        TOKEN,
        "daemon",
        client.challenge,
        client.nonce,
        DAEMON_PROTOCOL,
        "1.2.3",
        process.pid,
      ),
    });
  });

  it.skipIf(process.platform === "win32")("restricts the socket to its owner", async () => {
    await startServer();
    expect((await stat(endpoint)).mode & 0o777).toBe(0o600);
  });

  describe.skipIf(process.platform === "win32")("socket directory", () => {
    beforeEach(async () => {
      endpoint = endpointFor(dir);
      await chmod(dir, 0o755);
    });

    it("creates a private run directory without changing home permissions", async () => {
      await startServer();
      expect((await stat(join(dir, "run"))).mode & 0o777).toBe(0o700);
      expect((await stat(dir)).mode & 0o777).toBe(0o755);
    });

    it.each([0o755, 0o777])("tightens an existing run directory with mode %s", async (mode) => {
      await mkdir(join(dir, "run"));
      await chmod(join(dir, "run"), mode);
      await startServer();
      expect((await stat(join(dir, "run"))).mode & 0o777).toBe(0o700);
      expect((await stat(dir)).mode & 0o777).toBe(0o755);
      const client = await openClient();
      expect((await client.hello()).kind).toBe("hello_ok");
    });

    it("rejects a foreign directory without changing its permissions", async () => {
      const run = join(dir, "run");
      await mkdir(run);
      await chmod(run, 0o777);
      const uid = process.getuid!();
      const getuid = vi.spyOn(process, "getuid").mockReturnValue(uid + 1);
      try {
        await expect(createServer().listen()).rejects.toThrow(/owned by the current user/);
        expect((await stat(run)).mode & 0o777).toBe(0o777);
      } finally {
        getuid.mockRestore();
      }
    });

    it("rejects a symlinked directory without changing its target permissions", async () => {
      const target = join(dir, "target");
      await mkdir(target);
      await chmod(target, 0o755);
      await symlink(target, join(dir, "run"));
      await expect(createServer().listen()).rejects.toThrow(/must be a directory/);
      expect((await stat(target)).mode & 0o777).toBe(0o755);
    });
  });

  it("turns a wrong token away and closes the connection", async () => {
    await startServer();
    const client = await openClient();
    const reply = await client.hello("b".repeat(64));
    expect(reply.kind).toBe("hello_error");
    await client.closed.promise;
  });

  it("rejects a first frame that is not hello", async () => {
    await startServer();
    const client = await openClient();
    client.send({ kind: "command", id: 1, command: { type: "get_snapshot" } });
    expect((await client.next()).kind).toBe("hello_error");
    await client.closed.promise;
  });

  it("still reports its own protocol to a client that speaks another one", async () => {
    await startServer();
    const client = await openClient();
    const reply = await client.hello(TOKEN, DAEMON_PROTOCOL + 1);
    expect(reply).toMatchObject({ kind: "hello_ok", protocol: DAEMON_PROTOCOL });
  });

  it("closes a client that sends no hello in time", async () => {
    await startServer(new FakeHost(), { helloTimeoutMs: 50 });
    const client = await openClient();
    await client.closed.promise;
  });

  it("runs a command and answers with a result, or an error", async () => {
    const { host } = await startServer();
    const client = await openClient();
    await client.hello();
    client.send({ kind: "command", id: 7, command: { type: "get_snapshot" } });
    expect(await client.next()).toEqual({
      kind: "result",
      id: 7,
      ok: true,
      data: { status: "idle" },
    });
    client.send({ kind: "command", id: 8, command: { type: "new_chat" } });
    expect(await client.next()).toEqual({ kind: "result", id: 8, ok: false, error: "boom" });
    expect(host.commands.map((command) => command.type)).toEqual(["get_snapshot", "new_chat"]);
  });

  it("answers only the client that asked", async () => {
    await startServer();
    const asker = await openClient();
    const other = await openClient();
    await asker.hello();
    await other.hello();
    asker.send({ kind: "command", id: 1, command: { type: "get_snapshot" } });
    await asker.next();
    expect(other.frames).toEqual([]);
  });

  it("broadcasts events and URLs to every authenticated client, not to unauthenticated ones", async () => {
    const { server } = await startServer();
    const first = await openClient();
    const second = await openClient();
    const stranger = await openClient();
    await first.hello();
    await second.hello();

    server.output.emit({ type: "status", status: "running" });
    server.output.openUrl("https://example.com/");

    for (const client of [first, second]) {
      expect(await client.next()).toEqual({
        kind: "event",
        event: { type: "status", status: "running" },
      });
      expect(await client.next()).toEqual({ kind: "open_url", url: "https://example.com/" });
    }
    expect(stranger.frames).toEqual([]);
  });

  it("imports vault entries through the host", async () => {
    const { host } = await startServer();
    const client = await openClient();
    await client.hello();
    const entries = { openai: { type: "api_key", key: "sk-1" } };
    client.send({ kind: "vault_import", id: 3, entries });
    expect(await client.next()).toEqual({ kind: "result", id: 3, ok: true, data: null });
    expect(host.imported).toEqual([entries]);
  });

  it("refuses to start when another server owns the socket", async () => {
    await startServer();
    const second = createServer();
    expect(await second.listen()).toBe("already-running");
    await second.close();
    // The first server still works.
    const client = await openClient();
    expect((await client.hello()).kind).toBe("hello_ok");
  });

  it.skipIf(process.platform === "win32")("replaces a leftover socket file", async () => {
    // A daemon that died leaves its socket file behind; nothing answers on it.
    await writeFile(endpoint, "");
    const { server } = await startServer();
    expect(server.clientCount).toBe(0);
    const client = await openClient();
    expect((await client.hello()).kind).toBe("hello_ok");
  });

  it("calls onShutdown when an authenticated client asks, and ignores anyone else", async () => {
    const shutdown = Promise.withResolvers<void>();
    let calls = 0;
    await startServer(new FakeHost(), {
      onShutdown: () => {
        calls += 1;
        shutdown.resolve();
      },
    });
    const stranger = await openClient();
    stranger.send({ kind: "shutdown" });
    await stranger.closed.promise;
    expect(calls).toBe(0);

    const client = await openClient();
    await client.hello();
    client.send({ kind: "shutdown" });
    await shutdown.promise;
    expect(calls).toBe(1);
  });

  it("disconnects clients and frees the endpoint when closed", async () => {
    const { server } = await startServer();
    const client = await openClient();
    await client.hello();
    await server.close();
    await client.closed.promise;
    expect(await createServer().listen()).toBe("listening");
  });
});

describe("DaemonServer browser bridge", () => {
  async function browserClient(): Promise<TestClient> {
    const client = await openClient();
    await client.hello();
    client.send({ kind: "browser_available", available: true });
    // Let the server read the frame before the test asks for the browser.
    await new Promise((resolve) => setTimeout(resolve, 20));
    return client;
  }

  it("is unavailable until a client offers its browser", async () => {
    const { server } = await startServer();
    const client = await openClient();
    await client.hello();
    expect(server.browser.available()).toBe(false);
    await expect(server.browser.request({ action: "tabs" })).rejects.toThrow(/window is open/);
  });

  it("sends a request to the newest client that offered its browser, and returns its answer", async () => {
    const { server } = await startServer();
    const older = await browserClient();
    const newer = await browserClient();
    expect(server.browser.available()).toBe(true);
    const answer = server.browser.request({ action: "snapshot", tab: "tab-1" });
    const frame = await newer.next();
    expect(frame).toMatchObject({
      kind: "browser_request",
      request: { action: "snapshot", tab: "tab-1" },
    });
    if (frame.kind !== "browser_request") throw new Error("Expected a browser request");
    // A response from a client that was not asked is ignored.
    older.send({ kind: "browser_response", id: frame.id, ok: true, result: { text: "wrong" } });
    newer.send({ kind: "browser_response", id: frame.id, ok: true, result: { text: "page" } });
    await expect(answer).resolves.toEqual({ text: "page" });
    expect(older.frames).toEqual([]);
  });

  it("passes on a client's error and fails requests of a client that leaves", async () => {
    const { server } = await startServer();
    const client = await browserClient();
    const failing = server.browser.request({ action: "click", ref: "e1" });
    const first = await client.next();
    if (first.kind !== "browser_request") throw new Error("Expected a browser request");
    client.send({
      kind: "browser_response",
      id: first.id,
      ok: false,
      error: "Element e1 is gone.",
    });
    await expect(failing).rejects.toThrow("Element e1 is gone.");

    const pending = server.browser.request({ action: "tabs" });
    await client.next();
    client.close();
    await expect(pending).rejects.toThrow(/window closed/);
    expect(server.browser.available()).toBe(false);
  });

  it("stops waiting when the tool call is aborted", async () => {
    const { server } = await startServer();
    const client = await browserClient();
    const controller = new AbortController();
    const pending = server.browser.request({ action: "wait", ms: 5000 }, controller.signal);
    await client.next();
    controller.abort();
    await expect(pending).rejects.toThrow(/stopped/);
  });

  it("forgets a client that withdraws its browser", async () => {
    const { server } = await startServer();
    const client = await browserClient();
    client.send({ kind: "browser_available", available: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.browser.available()).toBe(false);
  });
});

describe("ensureToken", () => {
  it("creates a 64-character hex token once and reuses it", async () => {
    const file = join(dir, "agentd.token");
    const token = await ensureToken(file);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await ensureToken(file)).toBe(token);
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
  });
});
