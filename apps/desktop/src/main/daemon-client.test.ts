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

async function setup(authenticated: boolean) {
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
        if (frame.kind !== "hello") continue;
        socket.write(
          encodeFrame({
            kind: "hello_ok",
            protocol: DAEMON_PROTOCOL,
            appVersion: "1.0.0",
            pid: process.pid,
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
