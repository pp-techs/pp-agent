import { describe, expect, test } from "vite-plus/test";

import {
  addressPresetUrl,
  availablePresets,
  connectorHost,
  matchesPreset,
  MCP_PRESETS,
  presetServer,
  serverName,
} from "./mcp-catalog";

const preset = (id: string) => {
  const found = MCP_PRESETS.find((item) => item.id === id);
  if (!found) throw new Error(`no preset ${id}`);
  return found;
};

describe("MCP catalog", () => {
  test("every preset id is a valid, unique server name", () => {
    const ids = MCP_PRESETS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("a sign-in preset registers its own client, so it carries no OAuth client or header", () => {
    const server = presetServer(preset("notion"), { name: "notion", description: "Pages" });
    expect(server).toMatchObject({ transport: "http", url: "https://mcp.notion.com/mcp" });
    expect(server.headers).toBeUndefined();
    expect(server.oauth).toBeUndefined();
  });

  test("a Google preset signs in with the app's client and its own scopes", () => {
    const server = presetServer(preset("gmail"), {
      name: "gmail",
      description: "Mail",
      googleClient: { clientId: "id", clientSecret: "secret" },
    });
    expect(server.oauth).toEqual({
      clientId: "id",
      clientSecret: "secret",
      scope:
        "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
    });
    expect(() => presetServer(preset("gmail"), { name: "gmail", description: "Mail" })).toThrow();
  });

  test("Google presets are offered only when the app has a Google client", () => {
    const withClient = availablePresets({ clientId: "id" }).map((item) => item.id);
    const without = availablePresets(null).map((item) => item.id);
    expect(withClient).toContain("gmail");
    expect(without).not.toContain("gmail");
    expect(without).toContain("notion");
  });

  test("the folder is the last argument and the preset's own arguments stay untouched", () => {
    const filesystem = preset("filesystem");
    const server = presetServer(filesystem, {
      name: "filesystem",
      description: "Files",
      folder: "/Users/me/Docs",
    });
    expect(server.args).toEqual([
      "-y",
      "@modelcontextprotocol/server-filesystem",
      "/Users/me/Docs",
    ]);
    expect(filesystem.connection).toMatchObject({
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
    });
  });

  test("an account label names the server after it, with accents and symbols folded", () => {
    const gmail = preset("gmail");
    expect(serverName(gmail, undefined, [])).toBe("gmail");
    expect(serverName(gmail, "Work", ["gmail"])).toBe("gmail-work");
    expect(serverName(gmail, "Công việc", ["gmail"])).toBe("gmail-cong-viec");
    expect(serverName(gmail, "an@x.vn", ["gmail"])).toBe("gmail-an-x-vn");
    expect(serverName(gmail, "***", ["gmail"])).toBe("gmail-2");
  });

  test("a taken name gets the next free numeric suffix", () => {
    const gmail = preset("gmail");
    expect(serverName(gmail, undefined, ["gmail"])).toBe("gmail-2");
    expect(serverName(gmail, undefined, ["gmail", "gmail-2"])).toBe("gmail-3");
    expect(serverName(gmail, "Work", ["gmail", "gmail-work"])).toBe("gmail-work-2");
  });

  test("every account of a service matches its preset, whatever its name or trailing slash", () => {
    const first = presetServer(preset("notion"), { name: "notion", description: "" });
    const second = presetServer(preset("notion"), {
      name: "notion-work",
      description: "",
      account: "Work",
    });
    expect(second.account).toBe("Work");
    expect(matchesPreset(preset("notion"), { ...first, url: `${first.url}/` })).toBe(true);
    expect(matchesPreset(preset("notion"), second)).toBe(true);
    expect(matchesPreset(preset("linear"), first)).toBe(false);
    const files = presetServer(preset("filesystem"), {
      name: "docs",
      description: "",
      folder: "/tmp",
    });
    expect(matchesPreset(preset("filesystem"), files)).toBe(true);
    expect(matchesPreset(preset("notion"), files)).toBe(false);
  });

  test("an address preset is offered without a Google client and appends its path to the address", () => {
    expect(availablePresets(null).map((item) => item.id)).toContain("pp-hub");
    const ppHub = preset("pp-hub");
    expect(addressPresetUrl(ppHub, "hub.acme.vn")).toBe("https://hub.acme.vn/mcp/");
    expect(addressPresetUrl(ppHub, " https://hub.acme.vn/ ")).toBe("https://hub.acme.vn/mcp/");
    // A pasted /mcp/ address keeps the host and gets the preset's own path.
    expect(addressPresetUrl(ppHub, "https://hub.acme.vn/mcp/")).toBe("https://hub.acme.vn/mcp/");
    // Plain http is only for a hub on this computer.
    expect(addressPresetUrl(ppHub, "http://localhost:3000")).toBe("http://localhost:3000/mcp/");
    for (const bad of ["", "ftp://hub.acme.vn", "http://hub.acme.vn", "https://hub.acme.vn/?x=1"]) {
      expect(addressPresetUrl(ppHub, bad)).toBeNull();
    }
  });

  test("an address preset saves the hub and asks for the sign-in its authorization server needs", () => {
    const ppHub = preset("pp-hub");
    const server = presetServer(ppHub, {
      name: "pp-hub",
      description: "Company drive",
      address: "hub.acme.vn",
    });
    expect(server).toMatchObject({
      transport: "http",
      url: "https://hub.acme.vn/mcp/",
      connector: "pp-hub",
    });
    expect(server.headers).toBeUndefined();
    expect(server.oauth).toEqual({
      clientRegistration: "cimd",
      // Logto denies a consent request that names no scope at all.
      scope: "openid offline_access",
    });
    expect(() => presetServer(ppHub, { name: "pp-hub", description: "" })).toThrow();
    // The row under the card is named after the hub it points at, not the server's name.
    expect(connectorHost(server.url)).toBe("hub.acme.vn");
    expect(connectorHost(undefined)).toBeUndefined();
  });

  test("an address preset's servers match it whatever hub they point at", () => {
    const ppHub = preset("pp-hub");
    const work = presetServer(ppHub, { name: "pp-hub", description: "", address: "hub.acme.vn" });
    const other = presetServer(ppHub, {
      name: "pp-hub-2",
      description: "",
      address: "https://docs.other.vn",
    });
    expect(matchesPreset(ppHub, work)).toBe(true);
    expect(matchesPreset(ppHub, other)).toBe(true);
    expect(matchesPreset(preset("notion"), work)).toBe(false);
    // Added by hand under Settings › MCP: no connector was written, so nothing claims it.
    expect(matchesPreset(ppHub, { ...work, connector: undefined })).toBe(false);
  });
});
