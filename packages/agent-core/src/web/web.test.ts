import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppSettings } from "@workspace/shared";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vite-plus/test";
import { SHELL_TOOL, toolRule } from "../tools.ts";
import { fetchPage, htmlToText, isBlockedAddress } from "./fetch.ts";
import type { VaultCredentialStore } from "../credentials.ts";
import type { SettingsStore } from "../settings-store.ts";
import {
  parseDuckDuckGoHtml,
  parseExaMcpText,
  providerDef,
  SearchProviderError,
} from "./providers.ts";
import { WebSearchService } from "./search.ts";
import { extractWithWebclaw } from "./webclaw.ts";

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

describe("webclaw extraction", () => {
  const page = `<html><head><title>T</title></head><body><nav>menu</nav><main><h1>Heading</h1>${"<p>Body text.</p>".repeat(5)}</main></body></html>`;
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "pp-webclaw-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function fake(name: string, script: string): string {
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\n${script}\n`);
    chmodSync(path, 0o755);
    return path;
  }

  test("is skipped when there is no binary", async () => {
    expect(await extractWithWebclaw(page, { binary: null })).toBeNull();
    expect(await extractWithWebclaw(page, { binary: join(dir, "missing") })).toBeNull();
  });

  test.skipIf(process.platform === "win32")("reads the page from stdin", async () => {
    const binary = fake("echo", 'echo "args: $*"; cat');
    const text = await extractWithWebclaw("<p>hello</p>", { binary });
    expect(text).toContain("args: --stdin --format llm");
    expect(text).toContain("<p>hello</p>");
  });

  test.skipIf(process.platform === "win32")("gives up on a failing or silent binary", async () => {
    expect(await extractWithWebclaw(page, { binary: fake("fail", "exit 3") })).toBeNull();
    expect(await extractWithWebclaw(page, { binary: fake("silent", "cat >/dev/null") })).toBeNull();
  });

  test.skipIf(process.platform === "win32")(
    "does not pass the app's secrets to the binary",
    async () => {
      process.env.PP_TEST_SECRET = "hunter2";
      try {
        const text = await extractWithWebclaw(page, { binary: fake("env", "env") });
        expect(text).not.toContain("hunter2");
      } finally {
        delete process.env.PP_TEST_SECRET;
      }
    },
  );

  test.skipIf(process.platform === "win32")("stops when asked", async () => {
    const controller = new AbortController();
    const pending = extractWithWebclaw(page, {
      binary: fake("slow", "sleep 30"),
      signal: controller.signal,
    });
    controller.abort();
    expect(await pending).toBeNull();
  });

  test.skipIf(process.platform === "win32")(
    "htmlToText prefers a full extraction and falls back to the whole page",
    async () => {
      const long = "x".repeat(600);
      expect(await htmlToText(page, undefined, fake("long", `cat >/dev/null; echo ${long}`))).toBe(
        long,
      );
      // Too little from webclaw: the whole-page conversion is longer and wins.
      const whole = await htmlToText(page, undefined, fake("short", "cat >/dev/null; echo hi"));
      expect(whole).toContain("Heading");
      expect(whole).toContain("menu");
      // No binary at all.
      expect(await htmlToText(page, undefined, null)).toContain("Body text.");
    },
  );
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
    language: "system",
    notifications: true,
    tray: false,
    shortcutEnabled: false,
    shortcut: "CommandOrControl+Shift+Space",
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

const EXA_REPLY = `event: message
data: ${JSON.stringify({
  result: {
    content: [
      {
        type: "text",
        text: [
          "Title: The Async Ecosystem\nURL: https://rust-lang.github.io/async-book/\nPublished: 2024-05-01\nAuthor: N/A\nHighlights:\n## Async Runtimes\n\nRuntimes bundle a reactor.",
          "Title: Runtimes - Comprehensive Rust\nURL: https://google.github.io/comprehensive-rust/\nPublished: N/A\nAuthor: N/A\nHighlights:\nExecutors poll futures.",
        ].join("\n\n---\n\n"),
      },
    ],
  },
})}

`;

const DDG_PAGE = `<div class="result results_links web-result ">
  <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fx%3D1%26y%3D2&amp;rut=abc">Tom &amp; Jerry&#x27;s <b>page</b></a></h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">A <b>cat</b> and a mouse &quot;chase&quot;.</a>
</div>
<div class="result results_links result--ad ">
  <h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fads.example.com%2F">Sponsored</a></h2>
</div>
<div class="result results_links web-result ">
  <h2 class="result__title"><a class="result__a" href="https://direct.example.org/b">Direct link</a></h2>
</div>`;

describe("keyless result parsers", () => {
  test("Exa MCP text becomes hits", () => {
    expect(
      parseExaMcpText(JSON.parse(EXA_REPLY.split("data: ")[1]!).result.content[0].text),
    ).toEqual([
      {
        title: "The Async Ecosystem",
        url: "https://rust-lang.github.io/async-book/",
        snippet: "## Async Runtimes Runtimes bundle a reactor.",
        age: "2024-05-01",
      },
      {
        title: "Runtimes - Comprehensive Rust",
        url: "https://google.github.io/comprehensive-rust/",
        snippet: "Executors poll futures.",
      },
    ]);
  });

  test("DuckDuckGo HTML becomes hits: real address, text decoded, ads dropped", () => {
    expect(parseDuckDuckGoHtml(DDG_PAGE)).toEqual([
      {
        title: "Tom & Jerry's page",
        url: "https://example.com/a?x=1&y=2",
        snippet: 'A cat and a mouse "chase".',
      },
      { title: "Direct link", url: "https://direct.example.org/b", snippet: "" },
    ]);
    expect(parseDuckDuckGoHtml("<html>nothing</html>")).toEqual([]);
  });
});

describe("web search order", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function service(providers: string[], keys: Record<string, string> = {}) {
    const settings = { get: () => ({ webSearch: { providers, endpoints: {} } }) };
    const vault = {
      read: async (id: string) => {
        const key = keys[id.replace(/^websearch:/, "")];
        return key ? { type: "api_key", key } : undefined;
      },
    };
    return new WebSearchService(
      settings as unknown as SettingsStore,
      vault as unknown as VaultCredentialStore,
    );
  }

  /** Answers by host; the calls are kept to see which services were asked. */
  function stubNetwork(replies: Record<string, () => Response>) {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const host = new URL(String(input)).host;
      asked.push(host);
      const reply = replies[host];
      if (!reply) throw new Error(`unexpected request to ${host}`);
      return reply();
    });
    return asked;
  }

  const braveReply = () =>
    Response.json({
      web: { results: [{ title: "B", url: "https://b.example/", description: "d" }] },
    });
  const exaReply = () =>
    new Response(EXA_REPLY, { headers: { "Content-Type": "text/event-stream" } });
  const ddgReply = () => new Response(DDG_PAGE);

  test("a saved key is used first and the keyless services are not asked", async () => {
    const asked = stubNetwork({ "api.search.brave.com": braveReply });
    const outcome = await service(["brave"], { brave: "k" }).search({ query: "x", limit: 3 });
    expect(outcome.label).toBe("Brave Search");
    expect(asked).toEqual(["api.search.brave.com"]);
  });

  test("with nothing set up, Exa answers without a key and is labelled so", async () => {
    const asked = stubNetwork({ "mcp.exa.ai": exaReply });
    const outcome = await service([]).search({ query: "x", limit: 5 });
    expect(outcome.label).toBe("Exa (no key)");
    expect(outcome.hits).toHaveLength(2);
    expect(asked).toEqual(["mcp.exa.ai"]);
  });

  test("a failing key service falls through to the keyless ones", async () => {
    const asked = stubNetwork({
      "api.search.brave.com": () => new Response("denied", { status: 401 }),
      "mcp.exa.ai": () => new Response("busy", { status: 429 }),
      "html.duckduckgo.com": ddgReply,
    });
    const outcome = await service(["brave"], { brave: "bad" }).search({ query: "x", limit: 5 });
    expect(outcome.label).toBe("DuckDuckGo (no key)");
    expect(asked).toEqual(["api.search.brave.com", "mcp.exa.ai", "html.duckduckgo.com"]);
  });

  test("a service with no results is passed over", async () => {
    stubNetwork({
      "api.search.brave.com": () => Response.json({ web: { results: [] } }),
      "mcp.exa.ai": exaReply,
    });
    const outcome = await service(["brave"], { brave: "k" }).search({ query: "x", limit: 5 });
    expect(outcome.label).toBe("Exa (no key)");
  });

  test("when every service fails the error says why for each", async () => {
    stubNetwork({
      "mcp.exa.ai": () => new Response("busy", { status: 429 }),
      "html.duckduckgo.com": () => new Response("<html>anomaly</html>", { status: 202 }),
    });
    const error = await service([])
      .search({ query: "x", limit: 5 })
      .catch((e: unknown) => e);
    expect(String(error)).toMatch(/Exa: the usage limit was reached/);
    expect(String(error)).toMatch(/DuckDuckGo: the usage limit was reached/);
  });
});
