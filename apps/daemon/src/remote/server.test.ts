import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { createServer } from "node:net";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentCommand, AgentEvent } from "@workspace/shared";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { AddressLockout, PAIR_ATTEMPTS_PER_ADDRESS } from "./address-lockout.ts";
import { isOwnHost } from "./http.ts";
import { isLocalNetworkAddress, RemoteServer } from "./server.ts";
import { DEVICE_IDLE_MS } from "./store.ts";

/** A port nothing listens on right now. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address !== "object") throw new Error("no port");
  return address.port;
}

let dir: string;
let webDir: string | null;
let commands: AgentCommand[];
let emitted: AgentEvent[];
let servers: RemoteServer[];
/** Read by the server's `now` when set, so tests can move time on. */
let clock: number | null;
const blockedApp = { id: "com.example.blocked", name: "Blocked" };

function makeServer(): RemoteServer {
  const server = new RemoteServer({
    file: join(dir, "remote.json"),
    uploadsDir: join(dir, "uploads"),
    webDir: () => webDir,
    handle: async (command) => {
      commands.push(command);
      if (command.type === "abort") throw new Error("nothing to stop");
      if (command.type === "list_gateways")
        return [
          {
            id: "gw-team",
            name: "Team",
            api: "openai-completions",
            baseUrl: "https://llm.example/v1",
            models: [],
            requiresApiKey: true,
            hasApiKey: true,
          },
        ];
      if (command.type === "list_computer_apps")
        return { allowed: [{ id: "com.apple.Notes", name: "Notes" }], blocked: [blockedApp] };
      if (command.type === "list_telegram_accounts" || command.type === "list_zalo_accounts")
        return [
          { id: "default", enabled: true, pairingCode: "ABCDEFGH", pairingExpiresAt: 1 },
          { id: "work", enabled: false, pairingCode: "JKMNPQRS", pairingExpiresAt: 2 },
        ];
      if (command.type === "list_mcp_servers")
        return {
          servers: [
            {
              settings: {
                name: "crm",
                url: "https://crm.example",
                headers: { Authorization: "Bearer s3cret" },
              },
              state: "connected",
              toolCount: 1,
              usesOAuth: false,
            },
            {
              settings: { name: "files", command: "npx", env: { API_KEY: "k3y" } },
              state: "connected",
              toolCount: 2,
              usesOAuth: false,
            },
            {
              settings: {
                name: "gmail",
                url: "https://gmail.example",
                oauth: { clientId: "client-id", clientSecret: "cl13nt-s3cret" },
              },
              state: "connected",
              toolCount: 3,
              usesOAuth: true,
            },
          ],
          configErrors: [],
          configPath: "/x/mcp.json",
          authStorage: "encrypted",
        };
      return { echoed: command.type };
    },
    emit: (event) => emitted.push(event),
    appVersion: "1.2.3",
    host: "127.0.0.1",
    now: () => clock ?? Date.now(),
  });
  servers.push(server);
  return server;
}

async function enabled(server: RemoteServer): Promise<string> {
  await server.start();
  const status = await server.set(true, await freePort());
  expect(status.state).toBe("listening");
  return `http://127.0.0.1:${server.listeningPort}`;
}

async function pair(server: RemoteServer, base: string): Promise<string> {
  const { pairingCode } = await server.startPairing();
  const response = await fetch(`${base}/api/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: pairingCode, name: "Safari on iPhone" }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { token: string };
  return body.token;
}

function command(base: string, token: string | null, body: unknown, headers = {}) {
  return fetch(`${base}/api/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pp-remote-"));
  webDir = join(dir, "web");
  await mkdir(join(webDir, "assets"), { recursive: true });
  await writeFile(join(webDir, "index.html"), "<!doctype html><title>PP Agent</title>");
  await writeFile(join(webDir, "assets", "app-1234.js"), "console.log(1)");
  await writeFile(join(dir, "secret.txt"), "do not serve");
  commands = [];
  clock = null;
  emitted = [];
  servers = [];
});

afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  await rm(dir, { recursive: true, force: true });
});

describe("RemoteServer", () => {
  it("is off until turned on, and stays on across restarts", async () => {
    const server = makeServer();
    await server.start();
    expect((await server.status()).state).toBe("off");
    expect(server.listeningPort).toBeNull();

    const port = await freePort();
    await server.set(true, port);
    expect(server.listeningPort).toBe(port);
    expect(emitted).toContainEqual({ type: "settings_changed", scopes: ["remoteAccess"] });
    await server.close();

    const again = makeServer();
    await again.start();
    expect(again.listeningPort).toBe(port);
    const file = JSON.parse(await readFile(join(dir, "remote.json"), "utf8")) as object;
    expect(file).toMatchObject({ enabled: true, port });
    if (process.platform !== "win32")
      expect((await stat(join(dir, "remote.json"))).mode & 0o777).toBe(0o600);

    await again.set(false);
    expect(again.listeningPort).toBeNull();
  });

  it("refuses ports below 1024", async () => {
    const server = makeServer();
    await server.start();
    await expect(server.set(true, 80)).rejects.toThrow();
  });

  it("reports a missing web app instead of listening", async () => {
    webDir = null;
    const server = makeServer();
    await server.start();
    const status = await server.set(true, await freePort());
    expect(status.state).toBe("error");
    expect(status.error).toBeTruthy();
    expect(server.listeningPort).toBeNull();
  });

  it("serves the web app, falls back to index.html, and never leaves its folder", async () => {
    const server = makeServer();
    const base = await enabled(server);

    const index = await fetch(`${base}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toContain("text/html");
    expect(index.headers.get("x-frame-options")).toBe("DENY");
    expect(await index.text()).toContain("PP Agent");

    const asset = await fetch(`${base}/assets/app-1234.js`);
    expect(asset.headers.get("cache-control")).toContain("immutable");

    expect((await fetch(`${base}/settings/models`)).status).toBe(200);
    expect((await fetch(`${base}/missing.js`)).status).toBe(404);
    expect((await fetch(`${base}/..%2fsecret.txt`)).status).toBe(404);
    expect((await fetch(`${base}/%2e%2e/secret.txt`)).status).toBe(404);
  });

  it("pairs a device with the one-time code only", async () => {
    const server = makeServer();
    const base = await enabled(server);
    const attempt = (code: string) =>
      fetch(`${base}/api/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name: "Phone" }),
      });

    // No pairing open yet.
    expect((await attempt("ABCDEFGH")).status).toBe(400);
    const { pairingCode } = await server.startPairing();
    expect(pairingCode).toMatch(/^[A-Z0-9]{8}$/);
    expect((await attempt("WRONGCOD")).status).toBe(400);
    const ok = await attempt(pairingCode!);
    expect(ok.status).toBe(200);
    const { token } = (await ok.json()) as { token: string };
    // One use only.
    expect((await attempt(pairingCode!)).status).toBe(400);

    const session = await fetch(`${base}/api/session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await session.json()).toEqual({
      paired: true,
      deviceName: "Phone",
      appVersion: "1.2.3",
    });
    const anonymous = await fetch(`${base}/api/session`);
    expect(await anonymous.json()).toMatchObject({ paired: false });

    const status = await server.status();
    expect(status.pairingCode).toBeNull();
    expect(status.devices).toHaveLength(1);
    expect(status.devices[0]).toMatchObject({ name: "Phone", connected: false });
    // Only a hash of the token is written down.
    expect(await readFile(join(dir, "remote.json"), "utf8")).not.toContain(token.split(".")[1]);
  });

  it("locks one address after three wrong codes, until pairing starts again", async () => {
    const server = makeServer();
    const base = await enabled(server);
    const { pairingCode } = await server.startPairing();
    const attempt = (code: string | null | undefined) =>
      fetch(`${base}/api/pair`, { method: "POST", body: JSON.stringify({ code }) });
    const statuses: number[] = [];
    for (let i = 0; i < PAIR_ATTEMPTS_PER_ADDRESS; i++)
      statuses.push((await attempt("WRONGCOD")).status);
    expect(statuses).toEqual([400, 400, 429]);
    expect((await attempt(pairingCode)).status).toBe(429);
    // Only the computer can lift it, by starting a new pairing.
    const again = await server.startPairing();
    expect((await attempt(again.pairingCode)).status).toBe(200);
  });

  it("answers loopback only for a loopback Host", async () => {
    const server = makeServer();
    await enabled(server);
    const status = (host: string) => {
      const answered = Promise.withResolvers<number>();
      const req = request(
        { host: "127.0.0.1", port: server.listeningPort!, path: "/api/session", headers: { host } },
        (res) => {
          res.resume();
          answered.resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", answered.reject);
      req.end();
      return answered.promise;
    };
    expect(await status(`127.0.0.1:${server.listeningPort}`)).toBe(200);
    expect(await status(`localhost:${server.listeningPort}`)).toBe(200);
    // A tunnel to the internet (funnel, cloudflared, ngrok) arrives on loopback with its own name.
    expect(await status(`mac.tail1234.ts.net`)).toBe(403);
    expect(await status(`abcd.ngrok.app`)).toBe(403);
  });

  it("runs commands for paired devices and refuses local-only ones", async () => {
    const server = makeServer();
    const base = await enabled(server);
    expect((await command(base, null, { type: "get_snapshot" })).status).toBe(401);
    expect((await command(base, "nope.nope", { type: "get_snapshot" })).status).toBe(401);

    const token = await pair(server, base);
    const ok = await command(base, token, { type: "get_snapshot" });
    expect(await ok.json()).toEqual({ ok: true, data: { echoed: "get_snapshot" } });

    const failed = await command(base, token, { type: "abort" });
    expect(await failed.json()).toEqual({ ok: false, error: "nothing to stop" });

    for (const refused of [
      { type: "start_remote_pairing" },
      { type: "set_remote_access", enabled: true },
      { type: "save_mcp_json", text: "{}" },
      { type: "set_tool_policy", name: "bash", policy: "allow" },
      { type: "set_conversation_yolo", active: true },
      { type: "update_settings", patch: { yoloMode: true } },
      { type: "update_settings", patch: { shellEnabled: true } },
      { type: "start_telegram_pairing" },
      { type: "save_telegram", config: { enabled: true, agentId: null, workspaceId: "default" } },
      { type: "forget_telegram" },
      { type: "start_zalo_pairing" },
      { type: "save_zalo", config: { enabled: true, agentId: null, workspaceId: "default" } },
      { type: "forget_zalo" },
      { type: "delete_workspace", id: "w" },
      { type: "clear_sessions", workspaceId: "w" },
      { type: "clear_memory" },
      { type: "set_service_installed", installed: true },
      { type: "save_workspace", workspace: { name: "Home", icon: "🏠", dir: "/", agentId: null } },
      { type: "respond_approval", requestId: "r", approved: true, remember: "always" },
    ]) {
      expect((await command(base, token, refused)).status, refused.type).toBe(403);
    }
    expect((await command(base, token, { type: "set_conversation_yolo", active: false })).ok).toBe(
      true,
    );
    expect(
      (await command(base, token, { type: "update_settings", patch: { language: "vi" } })).ok,
    ).toBe(true);
    expect(commands.map((c) => c.type)).toEqual([
      "get_snapshot",
      "abort",
      "set_conversation_yolo",
      "update_settings",
    ]);
  });

  it("refuses requests from another site", async () => {
    const server = makeServer();
    const base = await enabled(server);
    const token = await pair(server, base);
    const response = await command(
      base,
      token,
      { type: "get_snapshot" },
      { Origin: "http://evil.example" },
    );
    expect(response.status).toBe(403);
    expect(commands).toHaveLength(0);
  });

  it("answers the phone app's origins with CORS, and no other site", async () => {
    const server = makeServer();
    const base = await enabled(server);
    const token = await pair(server, base);

    for (const origin of ["capacitor://localhost", "http://localhost"]) {
      const preflight = await fetch(`${base}/api/command`, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization, content-type",
          "Access-Control-Request-Private-Network": "true",
        },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
      expect(preflight.headers.get("access-control-allow-headers")).toContain("Authorization");
      expect(preflight.headers.get("access-control-allow-private-network")).toBe("true");

      const response = await command(base, token, { type: "get_snapshot" }, { Origin: origin });
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    }
    // The app still needs a token like any device.
    const unpaired = await command(
      base,
      null,
      { type: "get_snapshot" },
      { Origin: "http://localhost" },
    );
    expect(unpaired.status).toBe(401);

    for (const origin of ["http://localhost:5173", "https://localhost", "http://evil.example"]) {
      const preflight = await fetch(`${base}/api/command`, {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "POST" },
      });
      expect(preflight.status).toBe(403);
      expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
    }
    expect(commands).toEqual([{ type: "get_snapshot" }, { type: "get_snapshot" }]);
  });

  it("accepts only attachments the device uploaded", async () => {
    const server = makeServer();
    const base = await enabled(server);
    const token = await pair(server, base);

    const outside = await command(base, token, {
      type: "prompt",
      text: "read this",
      attachments: [{ name: "secret.txt", mimeType: "text/plain", path: join(dir, "secret.txt") }],
    });
    expect(outside.status).toBe(403);
    const sneaky = await command(base, token, {
      type: "prompt",
      text: "read this",
      attachments: [
        { name: "x", mimeType: "text/plain", path: join(dir, "uploads", "..", "secret.txt") },
      ],
    });
    expect(sneaky.status).toBe(403);

    const upload = await fetch(`${base}/api/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/pdf",
        "X-File-Name": encodeURIComponent("../../Báo cáo.pdf"),
      },
      body: "%PDF-1.4",
    });
    expect(upload.status).toBe(200);
    const attachment = (await upload.json()) as { name: string; mimeType: string; path: string };
    expect(attachment.name).toBe("Báo cáo.pdf");
    expect(attachment.mimeType).toBe("application/pdf");
    expect(attachment.path.startsWith(join(dir, "uploads"))).toBe(true);
    expect(await readFile(attachment.path, "utf8")).toBe("%PDF-1.4");

    const sent = await command(base, token, {
      type: "prompt",
      text: "hi",
      attachments: [attachment],
    });
    expect(await sent.json()).toMatchObject({ ok: true });
  });

  it("streams events to paired devices until they are signed out", async () => {
    const server = makeServer();
    const base = await enabled(server);
    const token = await pair(server, base);
    const controller = new AbortController();
    const response = await fetch(`${base}/api/events`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    const readUntil = async (text: string) => {
      while (!received.includes(text)) {
        const { value, done } = await reader.read();
        if (done) return false;
        received += decoder.decode(value, { stream: true });
      }
      return true;
    };
    await readUntil(": connected");
    expect((await server.status()).devices[0]?.connected).toBe(true);

    server.broadcast({ type: "status", status: "running" });
    expect(await readUntil(`data: {"type":"status","status":"running"}`)).toBe(true);

    const [device] = (await server.status()).devices;
    await server.forgetDevice(device!.id);
    // The stream ends and the token no longer works.
    while (!(await reader.read()).done);
    expect((await command(base, token, { type: "get_snapshot" })).status).toBe(401);
    controller.abort();
  });

  it("binds uploads to the device that made them", async () => {
    const server = makeServer();
    const base = await enabled(server);
    const first = await pair(server, base);
    const second = await pair(server, base);
    const upload = await fetch(`${base}/api/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${first}`, "Content-Type": "text/plain" },
      body: "mine",
    });
    const attachment = (await upload.json()) as { path: string };
    const prompt = { type: "prompt", text: "hi", attachments: [attachment] };
    expect((await command(base, second, prompt)).status).toBe(403);
    expect((await command(base, first, prompt)).status).toBe(200);
    // Gone (swept after a day): a clear answer instead of a failed copy.
    await rm(attachment.path);
    expect((await command(base, first, prompt)).status).toBe(410);

    // Unpairing a device removes what it uploaded.
    await server.forgetDevice(first.split(".")[0]!);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(stat(attachment.path)).rejects.toThrow();
  });

  it("hides MCP keys and refuses the raw mcp.json", async () => {
    const server = makeServer();
    const base = await enabled(server);
    const token = await pair(server, base);
    const response = await command(base, token, { type: "list_mcp_servers" });
    const text = await response.text();
    expect(text).not.toContain("s3cret");
    expect(text).not.toContain("k3y");
    expect(text).not.toContain("cl13nt-s3cret");
    expect(text).toContain("client-id");
    expect(text).toContain("Authorization");
    expect(text).toContain("API_KEY");
    expect((await command(base, token, { type: "get_mcp_json" })).status).toBe(403);
    expect(
      (
        await command(base, token, {
          type: "set_computer_app_access",
          app: { id: "com.apple.Mail", name: "Mail" },
          access: "allowed",
        })
      ).status,
    ).toBe(403);
  });

  it("lets a device block or clear apps but not unblock one", async () => {
    const server = makeServer();
    const base = await enabled(server);
    const token = await pair(server, base);
    const access = (app: { id: string; name: string }, value: "blocked" | null) =>
      command(base, token, { type: "set_computer_app_access", app, access: value });
    expect((await access(blockedApp, null)).status).toBe(403);
    expect((await access({ ...blockedApp, id: ` ${blockedApp.id} ` }, null)).status).toBe(403);
    expect((await access({ id: "com.apple.Notes", name: "Notes" }, null)).status).toBe(200);
    expect((await access({ id: "com.apple.Notes", name: "Notes" }, "blocked")).status).toBe(200);
    expect(
      commands.flatMap((c) => (c.type === "set_computer_app_access" ? [c.access] : [])),
    ).toEqual([null, "blocked"]);
  });

  it("never shows a device the pairing code of any Telegram or Zalo account", async () => {
    const server = makeServer();
    const base = await enabled(server);
    const token = await pair(server, base);
    for (const type of ["list_telegram_accounts", "list_zalo_accounts"]) {
      const { data } = (await (await command(base, token, { type })).json()) as {
        data: Record<string, unknown>[];
      };
      expect(data).toHaveLength(2);
      for (const account of data)
        expect(account).toMatchObject({ pairingCode: null, pairingExpiresAt: null });
      expect(data[0]).toMatchObject({ id: "default", enabled: true });
    }
  });

  it("keeps three event streams per device, closing the oldest", async () => {
    const server = makeServer();
    const base = await enabled(server);
    const token = await pair(server, base);
    const controller = new AbortController();
    const open = async () => {
      const response = await fetch(`${base}/api/events`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      const reader = response.body!.getReader();
      await reader.read();
      return reader;
    };
    const first = await open();
    await open();
    await open();
    await open();
    // The first stream ends once a fourth one opens.
    while (!(await first.read()).done);
    controller.abort();
  });

  it("signs out a device unused for 30 days", async () => {
    clock = Date.now();
    const server = makeServer();
    const base = await enabled(server);
    const token = await pair(server, base);
    clock += DEVICE_IDLE_MS - 1;
    expect((await command(base, token, { type: "get_snapshot" })).status).toBe(200);
    // That use counts: the 30 days start again.
    clock += DEVICE_IDLE_MS;
    expect((await command(base, token, { type: "get_snapshot" })).status).toBe(401);
  });

  it("finishes saving when a device was last seen before it closes", async () => {
    clock = Date.now();
    const server = makeServer();
    const base = await enabled(server);
    const token = await pair(server, base);
    // Far enough on that the request's last-seen time is written to disk, in the background.
    const later = clock + 5 * 60_000;
    clock = later;
    expect((await command(base, token, { type: "get_snapshot" })).status).toBe(200);
    await server.close();
    const saved = JSON.parse(await readFile(join(dir, "remote.json"), "utf8")) as {
      devices: { lastSeenAt: number }[];
    };
    expect(saved.devices[0]?.lastSeenAt).toBe(later);
  });

  it("tells the window once remote.json is loaded", async () => {
    const server = makeServer();
    await server.start();
    expect(emitted).toContainEqual({ type: "settings_changed", scopes: ["remoteAccess"] });
  });
});

describe("AddressLockout", () => {
  it("locks only the address that sent the wrong codes", () => {
    const lockout = new AddressLockout();
    for (let i = 1; i < PAIR_ATTEMPTS_PER_ADDRESS; i++)
      expect(lockout.failed("192.168.1.9", 0)).toBe(false);
    expect(lockout.failed("192.168.1.9", 0)).toBe(true);
    expect(lockout.locked("192.168.1.9", 1)).toBe(true);
    expect(lockout.locked("192.168.1.20", 1)).toBe(false);
    lockout.clear();
    expect(lockout.locked("192.168.1.9", 1)).toBe(false);
  });
});

describe("gateway keys from devices", () => {
  it("are sent only to the address they were saved for", async () => {
    const server = makeServer();
    const base = await enabled(server);
    const token = await pair(server, base);
    const gateway = {
      id: "gw-team",
      name: "Team",
      api: "openai-completions",
      models: [],
      requiresApiKey: true,
    };
    const save = (baseUrl: string, apiKey?: string) =>
      command(base, token, { type: "save_gateway", gateway: { ...gateway, baseUrl, apiKey } });
    expect((await save("https://evil.example/v1")).status).toBe(403);
    expect((await save("https://LLM.example/v1/")).status).toBe(200);
    expect((await save("https://evil.example/v1", "typed-again")).status).toBe(200);
    const list = (baseUrl: string, apiKey?: string) =>
      command(base, token, {
        type: "fetch_gateway_models",
        api: "openai-completions",
        baseUrl,
        gatewayId: "gw-team",
        apiKey,
      });
    expect((await list("https://evil.example/v1")).status).toBe(403);
    // A blank key falls back to the stored one in the host, so it does not count as typed.
    expect((await list("https://evil.example/v1", "")).status).toBe(403);
    expect((await list("https://evil.example/v1", "   ")).status).toBe(403);
    expect(commands.some((c) => c.type === "fetch_gateway_models")).toBe(false);
    expect((await list("https://evil.example/v1", "typed-again")).status).toBe(200);
    expect((await list("https://llm.example/v1")).status).toBe(200);
    // A new gateway has no stored key to protect.
    expect(
      (
        await command(base, token, {
          type: "save_gateway",
          gateway: { ...gateway, id: undefined, baseUrl: "https://new.example" },
        })
      ).status,
    ).toBe(200);
  });
});

describe("isLocalNetworkAddress", () => {
  const lan = ["127.0.0.1", "192.168.1.5"];
  const tailnet = [...lan, "100.101.102.103"];

  it("accepts private and link-local addresses, never loopback", () => {
    for (const address of [
      "192.168.1.20",
      "10.0.0.5",
      "172.20.1.1",
      "169.254.3.4",
      "::ffff:192.168.1.20",
      "fd12:3456::1",
      "fe80::1",
    ])
      expect(isLocalNetworkAddress(address, lan), address).toBe(true);
    for (const address of [
      undefined,
      "127.0.0.1",
      "::1",
      "::ffff:127.0.0.1",
      "8.8.8.8",
      "172.32.0.1",
      "100.128.0.1",
      "2001:db8::1",
      "::ffff:1.1.1.1",
    ])
      expect(isLocalNetworkAddress(address, tailnet), String(address)).toBe(false);
  });

  it("trusts carrier-grade NAT only while this computer is on a tailnet", () => {
    expect(isLocalNetworkAddress("100.96.85.90", lan)).toBe(false);
    expect(isLocalNetworkAddress("100.96.85.90", tailnet)).toBe(true);
  });
});

describe("isOwnHost", () => {
  const lan = ["127.0.0.1", "::1", "192.168.1.5", "fe80::1"];
  const name = hostname().toLowerCase();
  const short = name.split(".")[0]!;

  it("accepts this computer's addresses and names", () => {
    for (const host of [
      "192.168.1.5:47830",
      "192.168.1.5",
      "[fe80::1]:47830",
      "localhost:47830",
      `${name}:47830`,
      `${short}.local:47830`,
    ])
      expect(isOwnHost(host, lan), host).toBe(true);
  });

  it("refuses other names, so a DNS-rebinding page gets 421", () => {
    for (const host of [
      undefined,
      "",
      "evil.example:47830",
      "192-168-1-5.nip.io:47830",
      "192.168.1.6:47830",
      "mac.tail1234.ts.net",
    ])
      expect(isOwnHost(host, lan), String(host)).toBe(false);
    // A Tailscale name counts only on a tailnet.
    expect(isOwnHost("mac.tail1234.ts.net", [...lan, "100.101.102.103"])).toBe(true);
  });
});
