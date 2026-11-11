import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpOAuthClient, McpServerSettings } from "@workspace/shared";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

import { McpConfigFile } from "./mcp.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pp-mcp-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const hub = (oauth: McpOAuthClient): McpServerSettings => ({
  name: "pp-hub",
  description: "Company drive",
  enabled: true,
  exposure: "codemode",
  transport: "http",
  url: "https://hub.acme.vn/mcp/",
  connector: "pp-hub",
  oauth,
});

describe("mcp.json", () => {
  test("keeps the connector that added the server and its document-based sign-in", () => {
    const file = new McpConfigFile(join(dir, "mcp.json"));
    file.saveServer(undefined, hub({ clientRegistration: "cimd", scope: "openid offline_access" }));

    expect(JSON.parse(readFileSync(file.path, "utf8")).mcpServers["pp-hub"]).toEqual({
      description: "Company drive",
      connector: "pp-hub",
      url: "https://hub.acme.vn/mcp/",
      oauth: { clientRegistration: "cimd", scope: "openid offline_access" },
    });

    const [entry] = file.servers();
    expect(entry?.settings.connector).toBe("pp-hub");
    expect(entry?.settings.oauth).toEqual({
      clientRegistration: "cimd",
      scope: "openid offline_access",
    });
  });

  test("a document-based sign-in never keeps a registered client id beside it", () => {
    const file = new McpConfigFile(join(dir, "mcp.json"));
    file.saveServer(undefined, hub({ clientId: "id", clientSecret: "secret" }));
    // Pi refuses `cimd` combined with a client id, so the stale client must go.
    file.saveServer("pp-hub", hub({ clientRegistration: "cimd", scope: "openid offline_access" }));

    expect(file.servers()[0]?.raw.oauth).toEqual({
      clientRegistration: "cimd",
      scope: "openid offline_access",
    });
  });
});
