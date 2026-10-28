import type { SearchProviderId } from "@workspace/shared";

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  /** Publication date or age as the service reports it. */
  age?: string;
}

export type Recency = "day" | "week" | "month" | "year";
export const RECENCIES: readonly Recency[] = ["day", "week", "month", "year"];

export interface SearchRequest {
  query: string;
  /** 1–10. */
  limit: number;
  recency?: Recency;
  signal?: AbortSignal;
}

export interface ProviderSetup {
  key?: string;
  /** Without a trailing slash. */
  endpoint?: string;
}

/** A search service answered with an error; `status` is the HTTP status when there was one. */
export class SearchProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SearchProviderError";
  }
}

export interface SearchProviderDef {
  id: SearchProviderId;
  label: string;
  usesKey: boolean;
  keyRequired: boolean;
  usesEndpoint: boolean;
  endpointRequired: boolean;
  helpUrl: string;
  search(request: SearchRequest, setup: ProviderSetup): Promise<SearchHit[]>;
}

/** Hard limit for one provider call, so a stuck service never stalls the conversation. */
const TIMEOUT_MS = 20_000;

async function requestText(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
): Promise<string> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.aborted)
      throw new SearchProviderError("The search service did not answer in time.");
    throw new SearchProviderError(
      `The search service could not be reached (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200).trim();
    throw new SearchProviderError(
      `The search service answered ${response.status}${detail ? `: ${detail}` : ""}.`,
      response.status,
    );
  }
  return response.text();
}

async function requestJson(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  try {
    return JSON.parse(await requestText(url, init, signal));
  } catch (error) {
    if (error instanceof SearchProviderError || signal?.aborted) throw error;
    throw new SearchProviderError("The search service sent an answer that is not JSON.");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Keeps results that have a web address, and caps the text the model has to read. */
function toHits(rows: unknown, read: (row: Record<string, unknown>) => SearchHit): SearchHit[] {
  if (!Array.isArray(rows)) return [];
  const hits: SearchHit[] = [];
  for (const row of rows) {
    const hit = read(asRecord(row));
    if (hit.url) hits.push({ ...hit, snippet: hit.snippet.slice(0, 600) });
  }
  return hits;
}

function needKey(setup: ProviderSetup): string {
  if (!setup.key) throw new SearchProviderError("No API key is saved.");
  return setup.key;
}

function needEndpoint(setup: ProviderSetup): string {
  if (!setup.endpoint) throw new SearchProviderError("No server address is saved.");
  return setup.endpoint;
}

const searxng: SearchProviderDef = {
  id: "searxng",
  label: "SearXNG",
  usesKey: true,
  keyRequired: false,
  usesEndpoint: true,
  endpointRequired: true,
  helpUrl: "https://docs.searxng.org/admin/installation.html",
  async search({ query, limit, recency, signal }, setup) {
    const base = needEndpoint(setup);
    // `!!g` style bangs make SearXNG answer with a redirect even for JSON requests.
    const cleaned = query
      .split(/\s+/)
      .filter((word) => !word.startsWith("!!"))
      .join(" ");
    const params = new URLSearchParams({ q: cleaned, format: "json" });
    // SearXNG knows day, month and year only.
    if (recency) params.set("time_range", recency === "week" ? "month" : recency);
    const body = asRecord(
      await requestJson(
        `${base}/search?${params.toString()}`,
        {
          headers: {
            Accept: "application/json",
            ...(setup.key ? { Authorization: `Bearer ${setup.key}` } : {}),
          },
        },
        signal,
      ),
    );
    return toHits(body.results, (row) => ({
      title: text(row.title),
      url: text(row.url),
      snippet: text(row.content),
      age: text(row.publishedDate) || undefined,
    })).slice(0, limit);
  },
};

const serper: SearchProviderDef = {
  id: "serper",
  label: "Serper",
  usesKey: true,
  keyRequired: true,
  usesEndpoint: false,
  endpointRequired: false,
  helpUrl: "https://serper.dev",
  async search({ query, limit, recency, signal }, setup) {
    const tbs = { day: "qdr:d", week: "qdr:w", month: "qdr:m", year: "qdr:y" };
    const body = asRecord(
      await requestJson(
        "https://google.serper.dev/search",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-KEY": needKey(setup) },
          body: JSON.stringify({ q: query, num: limit, ...(recency ? { tbs: tbs[recency] } : {}) }),
        },
        signal,
      ),
    );
    return toHits(body.organic, (row) => ({
      title: text(row.title),
      url: text(row.link),
      snippet: text(row.snippet),
      age: text(row.date) || undefined,
    })).slice(0, limit);
  },
};

const tavily: SearchProviderDef = {
  id: "tavily",
  label: "Tavily",
  usesKey: true,
  keyRequired: true,
  usesEndpoint: false,
  endpointRequired: false,
  helpUrl: "https://tavily.com",
  async search({ query, limit, recency, signal }, setup) {
    const body = asRecord(
      await requestJson(
        "https://api.tavily.com/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${needKey(setup)}`,
          },
          body: JSON.stringify({
            query,
            max_results: limit,
            ...(recency ? { time_range: recency } : {}),
          }),
        },
        signal,
      ),
    );
    return toHits(body.results, (row) => ({
      title: text(row.title),
      url: text(row.url),
      snippet: text(row.content),
      age: text(row.published_date) || undefined,
    })).slice(0, limit);
  },
};

const brave: SearchProviderDef = {
  id: "brave",
  label: "Brave Search",
  usesKey: true,
  keyRequired: true,
  usesEndpoint: false,
  endpointRequired: false,
  helpUrl: "https://brave.com/search/api/",
  async search({ query, limit, recency, signal }, setup) {
    const freshness = { day: "pd", week: "pw", month: "pm", year: "py" };
    const params = new URLSearchParams({ q: query, count: String(limit) });
    if (recency) params.set("freshness", freshness[recency]);
    const body = asRecord(
      await requestJson(
        `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
        { headers: { Accept: "application/json", "X-Subscription-Token": needKey(setup) } },
        signal,
      ),
    );
    return toHits(asRecord(body.web).results, (row) => ({
      title: text(row.title),
      url: text(row.url),
      snippet: text(row.description),
      age: text(row.age) || undefined,
    })).slice(0, limit);
  },
};

const DAY_MS = 86_400_000;
const RECENCY_DAYS: Record<Recency, number> = { day: 1, week: 7, month: 30, year: 365 };

/** Exa's public MCP server: web search without a key, the way coding agents use it. */
const EXA_MCP_URL = "https://mcp.exa.ai/mcp";

/** The JSON-RPC message of a Streamable HTTP reply: plain JSON, or the last `data:` event. */
function mcpMessage(body: string): Record<string, unknown> {
  const trimmed = body.trim();
  const candidates = trimmed.startsWith("{")
    ? [trimmed]
    : trimmed
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .reverse();
  for (const candidate of candidates) {
    try {
      return asRecord(JSON.parse(candidate));
    } catch {
      // Try the next event.
    }
  }
  throw new SearchProviderError("The search service sent an answer that is not JSON.");
}

/** Reads the `Title:`/`URL:`/`Published:`/`Highlights:` blocks Exa's `web_search_exa` returns. */
export function parseExaMcpText(body: string): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const block of body.split(/\n\s*---\s*\n/)) {
    const url = /^URL:[ \t]*(\S+)/m.exec(block)?.[1] ?? "";
    if (!url) continue;
    const published = /^Published:[ \t]*(.+)$/m.exec(block)?.[1]?.trim() ?? "";
    const highlights = block.split(/^Highlights:[ \t]*$/m)[1] ?? "";
    hits.push({
      title: /^Title:[ \t]*(.*)$/m.exec(block)?.[1]?.trim() ?? "",
      url,
      snippet: highlights.replace(/\s+/g, " ").trim().slice(0, 600),
      ...(published && published !== "N/A" ? { age: published } : {}),
    });
  }
  return hits;
}

async function searchExaKeyless({ query, limit, signal }: SearchRequest): Promise<SearchHit[]> {
  const reply = mcpMessage(
    await requestText(
      EXA_MCP_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "web_search_exa", arguments: { query, numResults: limit } },
        }),
      },
      signal,
    ),
  );
  const failure = asRecord(reply.error).message;
  if (typeof failure === "string") throw new SearchProviderError(failure.slice(0, 200));
  const result = asRecord(reply.result);
  const content = Array.isArray(result.content) ? result.content : [];
  const body = content.map((part) => text(asRecord(part).text)).join("\n\n---\n\n");
  if (result.isError === true) throw new SearchProviderError(body.slice(0, 200));
  return parseExaMcpText(body).slice(0, limit);
}

const exa: SearchProviderDef = {
  id: "exa",
  label: "Exa",
  usesKey: true,
  // Without a key it uses Exa's public MCP server.
  keyRequired: false,
  usesEndpoint: false,
  endpointRequired: false,
  helpUrl: "https://exa.ai",
  async search(request, setup) {
    if (!setup.key) return searchExaKeyless(request);
    const { query, limit, recency, signal } = request;
    const body = asRecord(
      await requestJson(
        "https://api.exa.ai/search",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": needKey(setup) },
          body: JSON.stringify({
            query,
            numResults: limit,
            contents: { text: { maxCharacters: 600 } },
            ...(recency
              ? {
                  startPublishedDate: new Date(
                    Date.now() - RECENCY_DAYS[recency] * DAY_MS,
                  ).toISOString(),
                }
              : {}),
          }),
        },
        signal,
      ),
    );
    return toHits(body.results, (row) => ({
      title: text(row.title),
      url: text(row.url),
      snippet: text(row.text),
      age: text(row.publishedDate) || undefined,
    })).slice(0, limit);
  },
};

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(
      /&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi,
      (whole, dec?: string, hex?: string, name?: string) => {
        if (dec || hex) {
          const code = dec ? Number(dec) : Number.parseInt(hex ?? "", 16);
          return Number.isInteger(code) && code > 0 && code <= 0x10ffff
            ? String.fromCodePoint(code)
            : whole;
        }
        return HTML_ENTITIES[(name ?? "").toLowerCase()] ?? whole;
      },
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** DuckDuckGo links go through `/l/?uddg=<address>`; this returns the address. */
function ddgTarget(href: string): string {
  const raw = plainText(href);
  try {
    const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw, "https://duckduckgo.com");
    const target =
      url.searchParams.get("uddg") ?? (url.hostname.endsWith("duckduckgo.com") ? "" : url.href);
    return /^https?:\/\//i.test(target) ? target : "";
  } catch {
    return "";
  }
}

/** Reads the result blocks of DuckDuckGo's HTML page; ads and blocks without an address are dropped. */
export function parseDuckDuckGoHtml(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const block of html.split(/<div class="result\b/).slice(1)) {
    if (/result--ad\b/.test(block.slice(0, 200))) continue;
    const title = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!title) continue;
    const url = ddgTarget(title[1] ?? "");
    if (!url) continue;
    hits.push({
      title: plainText(title[2] ?? ""),
      url,
      snippet: plainText(
        /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1] ?? "",
      ).slice(0, 600),
    });
  }
  return hits;
}

const duckduckgo: SearchProviderDef = {
  id: "duckduckgo",
  label: "DuckDuckGo",
  usesKey: false,
  keyRequired: false,
  usesEndpoint: false,
  endpointRequired: false,
  helpUrl: "https://duckduckgo.com",
  async search({ query, limit, recency, signal }) {
    const params = new URLSearchParams({ q: query });
    if (recency) params.set("df", { day: "d", week: "w", month: "m", year: "y" }[recency]);
    const html = await requestText(
      `https://html.duckduckgo.com/html/?${params.toString()}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
      },
      signal,
    );
    const hits = parseDuckDuckGoHtml(html);
    // After a burst of searches DuckDuckGo answers 202 with a "are you a robot" page.
    if (hits.length === 0 && /anomaly|captcha|unusual traffic/i.test(html))
      throw new SearchProviderError(
        "DuckDuckGo asked for a human check because of too many searches.",
        429,
      );
    return hits.slice(0, limit);
  },
};

export const WEBCLAW_CLOUD_URL = "https://api.webclaw.io";

const webclaw: SearchProviderDef = {
  id: "webclaw",
  label: "webclaw",
  usesKey: true,
  keyRequired: true,
  usesEndpoint: true,
  endpointRequired: false,
  helpUrl: "https://webclaw.io",
  async search({ query, limit, recency, signal }, setup) {
    const body = asRecord(
      await requestJson(
        `${setup.endpoint ?? WEBCLAW_CLOUD_URL}/v1/search`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${needKey(setup)}`,
          },
          // Result pages are read with web_fetch, only when the agent needs them.
          body: JSON.stringify({
            query,
            num_results: limit,
            scrape: false,
            ...(recency ? { freshness: recency } : {}),
          }),
        },
        signal,
      ),
    );
    return toHits(body.results, (row) => ({
      title: text(row.title),
      url: text(row.url),
      snippet: text(row.snippet),
    })).slice(0, limit);
  },
};

/** In the order Settings lists them. */
export const SEARCH_PROVIDER_DEFS: readonly SearchProviderDef[] = [
  searxng,
  serper,
  tavily,
  brave,
  exa,
  webclaw,
  duckduckgo,
];

/**
 * Tried after the services the person turned on, so a saved key always comes first. None needs a
 * key: the search words go to these services as they are.
 */
export const KEYLESS_FALLBACK: readonly SearchProviderId[] = ["exa", "duckduckgo"];

export function providerDef(id: SearchProviderId): SearchProviderDef {
  const def = SEARCH_PROVIDER_DEFS.find((candidate) => candidate.id === id);
  if (!def) throw new Error(`Unknown search provider: ${id}`);
  return def;
}
