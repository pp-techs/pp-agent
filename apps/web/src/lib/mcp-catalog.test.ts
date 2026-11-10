import { describe, expect, test } from "vite-plus/test";

import {
  availablePresets,
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
});
