import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentCommand, AgentEvent } from "@workspace/shared";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { isLocalNetworkAddress, RemoteServer } from "./server.ts";

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

  it("locks pairing after five wrong codes", async () => {
    const server = makeServer();
    const base = await enabled(server);
    const { pairingCode } = await server.startPairing();
    let last = 0;
    for (let i = 0; i < 5; i++) {
      const response = await fetch(`${base}/api/pair`, {
        method: "POST",
        body: JSON.stringify({ code: "WRONGCOD" }),
      });
      last = response.status;
    }
    expect(last).toBe(429);
    const right = await fetch(`${base}/api/pair`, {
      method: "POST",
      body: JSON.stringify({ code: pairingCode }),
    });
    expect(right.status).toBe(429);
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

  it("tells the window once remote.json is loaded", async () => {
    const server = makeServer();
    await server.start();
    expect(emitted).toContainEqual({ type: "settings_changed", scopes: ["remoteAccess"] });
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
  it("accepts private, link-local, loopback and CGNAT addresses only", () => {
    for (const address of [
      "192.168.1.20",
      "10.0.0.5",
      "172.20.1.1",
      "100.96.85.90",
      "169.254.3.4",
      "127.0.0.1",
      "::ffff:192.168.1.20",
      "::1",
      "fd12:3456::1",
      "fe80::1",
    ])
      expect(isLocalNetworkAddress(address), address).toBe(true);
    for (const address of [
      undefined,
      "8.8.8.8",
      "172.32.0.1",
      "100.128.0.1",
      "2001:db8::1",
      "::ffff:1.1.1.1",
    ])
      expect(isLocalNetworkAddress(address), String(address)).toBe(false);
  });
});
