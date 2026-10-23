import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AppSettings } from "@workspace/shared";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { SHELL_TOOL, toolRule } from "../tools.ts";
import { fetchPage, isBlockedAddress } from "./fetch.ts";
import { providerDef, SearchProviderError } from "./providers.ts";

describe("isBlockedAddress", () => {
  test.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::",
    "fe80::1",
    "fd12:3456::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::7f00:1",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  test.each(["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111"])(
    "allows %s",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );
});

describe("fetchPage", () => {
  let server: Server;
  let port: number;
  beforeAll(async () => {
    server = createServer((_request, response) => {
      response.end("<html><body>secret</body></html>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => {
    server.close();
  });

  test("refuses this computer, by IP and by name", async () => {
    await expect(fetchPage(`http://127.0.0.1:${port}/`)).rejects.toThrow(/private network/);
    await expect(fetchPage(`http://localhost:${port}/`)).rejects.toThrow(/private network/);
    await expect(fetchPage(`http://[::1]:${port}/`)).rejects.toThrow(/private network/);
  });

  test("refuses other schemes and embedded credentials", async () => {
    await expect(fetchPage("file:///etc/passwd")).rejects.toThrow(/http and https/);
    await expect(fetchPage("http://user:pw@example.com/")).rejects.toThrow(/user name/);
  });
});

describe("SearXNG provider", () => {
  let server: Server;
  let base: string;
  let lastUrl = "";
  beforeAll(async () => {
    server = createServer((request, response) => {
      lastUrl = request.url ?? "";
      if (request.headers.authorization === "Bearer bad") {
        response.statusCode = 403;
        response.end("nope");
        return;
      }
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          results: [
            { title: "One", url: "https://one.example/", content: "first" },
            { title: "No address", content: "dropped" },
          ],
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
  });

  test("maps results, drops rows without an address, strips external bangs", async () => {
    const hits = await providerDef("searxng").search(
      { query: "!!g cats", limit: 5, recency: "week" },
      { endpoint: base },
    );
    expect(hits).toEqual([{ title: "One", url: "https://one.example/", snippet: "first" }]);
    const params = new URL(lastUrl, base).searchParams;
    expect(params.get("q")).toBe("cats");
    expect(params.get("time_range")).toBe("month");
  });

  test("reports a rejected token with its status", async () => {
    const error = await providerDef("searxng")
      .search({ query: "x", limit: 1 }, { endpoint: base, key: "bad" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SearchProviderError);
    expect((error as SearchProviderError).status).toBe(403);
  });
});

describe("shell policy", () => {
  const settings = (overrides: Partial<AppSettings>): AppSettings => ({
    defaultModel: null,
    shellEnabled: true,
    toolPolicies: {},
    disabledSkills: [],
    activeAgentId: "default",
    thinkingLevel: "off",
    ...overrides,
  });

  test("is off until enabled, whatever its policy says", () => {
    const rule = toolRule(
      SHELL_TOOL,
      "exec",
      settings({ shellEnabled: false, toolPolicies: { [SHELL_TOOL]: "allow" } }),
    );
    expect(rule).toMatchObject({ effective: "off", locked: true });
  });

  test("asks by default and when set to something other than allow", () => {
    expect(toolRule(SHELL_TOOL, "exec", settings({}))).toMatchObject({ effective: "ask" });
    expect(
      toolRule(SHELL_TOOL, "exec", settings({ toolPolicies: { [SHELL_TOOL]: "off" } })),
    ).toMatchObject({ effective: "ask" });
  });

  test("runs freely only on allow, and then carries a warning", () => {
    const rule = toolRule(
      SHELL_TOOL,
      "exec",
      settings({ toolPolicies: { [SHELL_TOOL]: "allow" } }),
    );
    expect(rule).toMatchObject({ effective: "allow", locked: false });
    expect(rule.warning).toBeTruthy();
  });
});
