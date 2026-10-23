import { SEARCH_PROVIDERS, type SearchProviderId, type WebSearchConfig } from "@workspace/shared";

export function isSearchProviderId(value: unknown): value is SearchProviderId {
  return SEARCH_PROVIDERS.includes(value as SearchProviderId);
}

/** `https://host/path/` → `https://host/path`; null when it is not an http(s) URL. */
export function normalizeEndpoint(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function emptyWebSearchConfig(): WebSearchConfig {
  return { providers: [], endpoints: {} };
}

/** Reads the `webSearch` part of settings.json, dropping unknown providers and bad URLs. */
export function readWebSearchConfig(raw: unknown): WebSearchConfig {
  const config = emptyWebSearchConfig();
  if (typeof raw !== "object" || raw === null) return config;
  const value = raw as { providers?: unknown; endpoints?: unknown };
  if (Array.isArray(value.providers)) {
    for (const id of value.providers) {
      if (isSearchProviderId(id) && !config.providers.includes(id)) config.providers.push(id);
    }
  }
  if (typeof value.endpoints === "object" && value.endpoints !== null) {
    for (const [id, endpoint] of Object.entries(value.endpoints)) {
      if (!isSearchProviderId(id) || typeof endpoint !== "string") continue;
      const normalized = normalizeEndpoint(endpoint);
      if (normalized) config.endpoints[id] = normalized;
    }
  }
  return config;
}
