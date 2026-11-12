import { randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { proof } from "@workspace/daemon/auth";
import { encodeFrame, FrameDecoder } from "@workspace/daemon/framing";
import { resolveDaemonPaths } from "@workspace/daemon/paths";
import { DAEMON_PROTOCOL, type ClientFrame } from "@workspace/shared";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { DaemonClient } from "./daemon-client.ts";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));
vi.mock("./i18n.ts", () => ({ translator: () => (key: string) => key }));

let home: string;
let server: Server;
const sockets: Socket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (home) await rm(home, { recursive: true, force: true });
});

async function setup(authenticated: boolean, extra: { spawnedByApp?: boolean } = {}) {
  home = await mkdtemp(join(tmpdir(), "pp-client-"));
  const paths = resolveDaemonPaths({ PP_AGENT_HOME: home });
  const token = randomBytes(32).toString("hex");
  await writeFile(paths.tokenFile, token, { mode: 0o600 });
  if (process.platform !== "win32") {
    await mkdir(dirname(paths.endpoint), { recursive: true, mode: 0o700 });
  }
  const received: unknown[] = [];
  server = createServer((socket) => {
    sockets.push(socket);
    const nonce = randomBytes(32).toString("hex");
    const decoder = new FrameDecoder();
    socket.write(encodeFrame({ kind: "challenge", nonce }));
    socket.on("data", (data) => {
      for (const frame of decoder.push(data) as ClientFrame[]) {
        received.push(frame);
        // A real daemon stops on `shutdown`; a restart test needs it to drop the socket.
        if (frame.kind === "shutdown") {
          socket.end();
          continue;
        }
        if (frame.kind !== "hello") continue;
        socket.write(
          encodeFrame({
            kind: "hello_ok",
            protocol: DAEMON_PROTOCOL,
            appVersion: "1.0.0",
            pid: process.pid,
            spawnedByApp: extra.spawnedByApp === true,
            proof: proof(
              authenticated ? token : "attacker",
              "daemon",
              nonce,
              frame.nonce,
              DAEMON_PROTOCOL,
              "1.0.0",
              process.pid,
            ),
          }),
        );
        socket.write(encodeFrame({ kind: "open_url", url: "https://example.test" }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(paths.endpoint, resolve));
  if (process.platform !== "win32") await chmod(paths.endpoint, 0o600);
  const onOpenUrl = vi.fn();
  const client = new DaemonClient({
    home,
    daemonScript: "unused",
    resourcesDir: "unused",
    appVersion: "1.0.0",
    onOpenUrl,
    onBrowserRequest: vi.fn(),
    onComputerRequest: vi.fn(),
    onEvent: vi.fn(),
    onLost: vi.fn(),
    onConnected: vi.fn(),
    onStartFailed: vi.fn(),
  });
  return { client, onOpenUrl, received, token };
}

it("adopts only after verifying the daemon proof and never sends the token", async () => {
  const { client, received, token } = await setup(true);
  const connection = await client["establish"]();
  expect(connection).not.toBeNull();
  expect(client["conn"]).toBe(connection);
  expect(received[0]).toMatchObject({
    kind: "hello",
    nonce: expect.stringMatching(/^[0-9a-f]{64}$/),
    proof: expect.any(String),
  });
  expect(JSON.stringify(received)).not.toContain(token);
});

it("rejects an impostor before adopting or delivering buffered frames", async () => {
  const { client, onOpenUrl } = await setup(false);
  await expect(client["establish"]()).rejects.toThrow(/authentication proof is invalid/);
  expect(client["conn"]).toBeNull();
  expect(onOpenUrl).not.toHaveBeenCalled();
});

it("stops a daemon an earlier app started on quit, even though this app did not spawn it", async () => {
  // A daemon left behind by a crashed app: reused here, and stopped when this app quits.
  const { client, received } = await setup(true, { spawnedByApp: true });
  await client["establish"]();
  client.dispose();
  await vi.waitFor(() =>
    expect(received.some((frame) => (frame as ClientFrame).kind === "shutdown")).toBe(true),
  );
});

it("leaves a login-service daemon running on quit", async () => {
  const { client, received } = await setup(true, { spawnedByApp: false });
  await client["establish"]();
  client.dispose();
  // Give a stray shutdown frame the chance to arrive, then prove none did.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(received.some((frame) => (frame as ClientFrame).kind === "shutdown")).toBe(false);
});

it("restarts the daemon on request and resolves once the new one answers", async () => {
  const { client, received } = await setup(true, { spawnedByApp: false });
  client.start();
  await vi.waitFor(() => expect(client["conn"]).not.toBeNull());
  const first = client["conn"];
  await client.restartAgent();
  expect(received.some((frame) => (frame as ClientFrame).kind === "shutdown")).toBe(true);
  expect(client["conn"]).not.toBeNull();
  expect(client["conn"]).not.toBe(first);
  client.dispose();
});

it("stops even a login-service daemon before an update, telling it to leave the service stopped", async () => {
  const { client, received } = await setup(true, { spawnedByApp: false });
  client.start();
  await vi.waitFor(() => expect(client["conn"]).not.toBeNull());
  await client.stopForUpdate(2_000);
  expect(received).toContainEqual({ kind: "shutdown", forUpdate: true });
  client.dispose();
});
