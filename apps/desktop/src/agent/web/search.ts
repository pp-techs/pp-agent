import type {
  SaveWebSearchInput,
  SearchProviderId,
  SearchProviderView,
  WebSearchTestResult,
  WebSearchView,
} from "@workspace/shared";
import type { VaultCredentialStore } from "../credentials.ts";
import { t } from "../i18n.ts";
import type { SettingsStore } from "../settings-store.ts";
import { isSearchProviderId, normalizeEndpoint } from "./config.ts";
import { WEB_KEY_PREFIX } from "./names.ts";
import {
  providerDef,
  SEARCH_PROVIDER_DEFS,
  SearchProviderError,
  type ProviderSetup,
  type SearchHit,
  type SearchRequest,
} from "./providers.ts";

export interface SearchOutcome {
  provider: SearchProviderId;
  label: string;
  hits: SearchHit[];
}

export const SETTINGS_HINT = "Settings › Tools › Web search";

function describeFailure(error: unknown): string {
  if (error instanceof SearchProviderError) {
    if (error.status === 401 || error.status === 403)
      return "the key or sign-in was rejected. Check it in Settings.";
    if (error.status === 429) return "the usage limit was reached.";
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Why a search service failed, in the person's language, for the Test button in Settings. */
function describeFailureForPerson(error: unknown): string {
  if (error instanceof SearchProviderError) {
    if (error.status === 401 || error.status === 403) return t("webSearch.keyRejected");
    if (error.status === 429) return t("webSearch.limitReached");
  }
  return describeFailure(error);
}

/** Search configuration (settings.json) plus the keys (encrypted vault), and the search itself. */
export class WebSearchService {
  constructor(
    private readonly settings: SettingsStore,
    private readonly credentials: VaultCredentialStore,
  ) {}

  private async keyOf(id: SearchProviderId): Promise<string | undefined> {
    const credential = await this.credentials.read(WEB_KEY_PREFIX + id);
    return credential?.type === "api_key" ? credential.key : undefined;
  }

  private async setupOf(id: SearchProviderId): Promise<ProviderSetup> {
    const endpoint = this.settings.get().webSearch.endpoints[id];
    const key = await this.keyOf(id);
    return { ...(key ? { key } : {}), ...(endpoint ? { endpoint } : {}) };
  }

  async view(): Promise<WebSearchView> {
    const { providers: enabledIds, endpoints } = this.settings.get().webSearch;
    const views: SearchProviderView[] = [];
    for (const def of SEARCH_PROVIDER_DEFS) {
      const hasKey = (await this.keyOf(def.id)) !== undefined;
      const endpoint = endpoints[def.id] ?? "";
      views.push({
        id: def.id,
        label: def.label,
        usesKey: def.usesKey,
        keyRequired: def.keyRequired,
        hasKey,
        usesEndpoint: def.usesEndpoint,
        endpointRequired: def.endpointRequired,
        endpoint,
        enabled: enabledIds.includes(def.id),
        configured: (!def.keyRequired || hasKey) && (!def.endpointRequired || endpoint !== ""),
        helpUrl: def.helpUrl,
      });
    }
    const rank = (view: SearchProviderView) => {
      const position = enabledIds.indexOf(view.id);
      return position === -1 ? enabledIds.length : position;
    };
    return { providers: views.sort((a, b) => rank(a) - rank(b)) };
  }

  async save(input: SaveWebSearchInput): Promise<WebSearchView> {
    const providers = [...new Set(input.providers)];
    if (!providers.every(isSearchProviderId)) throw new Error(t("webSearch.unknownProvider"));
    const endpoints: Partial<Record<SearchProviderId, string>> = {};
    for (const def of SEARCH_PROVIDER_DEFS) {
      const raw = input.endpoints[def.id]?.trim();
      if (!raw || !def.usesEndpoint) continue;
      const endpoint = normalizeEndpoint(raw);
      if (!endpoint) throw new Error(t("webSearch.endpointInvalid", { provider: def.label }));
      endpoints[def.id] = endpoint;
    }
    for (const [id, key] of Object.entries(input.keys)) {
      if (!isSearchProviderId(id) || key === undefined || !providerDef(id).usesKey) continue;
      const trimmed = key?.trim();
      if (trimmed)
        await this.credentials.modify(WEB_KEY_PREFIX + id, async () => ({
          type: "api_key",
          key: trimmed,
        }));
      else await this.credentials.delete(WEB_KEY_PREFIX + id);
    }
    this.settings.update((draft) => {
      draft.webSearch = { providers, endpoints };
    });
    return this.view();
  }

  /** Runs `request` against the enabled providers in order; the first to answer wins. */
  async search(request: SearchRequest): Promise<SearchOutcome> {
    const { providers } = this.settings.get().webSearch;
    const failures: string[] = [];
    for (const id of providers) {
      const def = providerDef(id);
      const setup = await this.setupOf(id);
      if ((def.keyRequired && !setup.key) || (def.endpointRequired && !setup.endpoint)) {
        failures.push(`${def.label}: not fully set up.`);
        continue;
      }
      try {
        return { provider: id, label: def.label, hits: await def.search(request, setup) };
      } catch (error) {
        if (request.signal?.aborted) throw error;
        failures.push(`${def.label}: ${describeFailure(error)}`);
      }
    }
    if (providers.length === 0)
      throw new Error(
        `Web search is not set up. Ask the user to add a search service in ${SETTINGS_HINT}.`,
      );
    throw new Error(
      `Every search service failed. ${failures.join(" ")} Ask the user to check ${SETTINGS_HINT}.`,
    );
  }

  /** Runs one search against a single provider, for the Test button. */
  async test(id: SearchProviderId): Promise<WebSearchTestResult> {
    const def = providerDef(id);
    const setup = await this.setupOf(id);
    if (def.keyRequired && !setup.key) return { ok: false, message: t("webSearch.saveKeyFirst") };
    if (def.endpointRequired && !setup.endpoint)
      return { ok: false, message: t("webSearch.saveAddressFirst") };
    try {
      const hits = await def.search({ query: "weather today", limit: 1 }, setup);
      return {
        ok: true,
        message: hits.length > 0 ? t("webSearch.working") : t("webSearch.noResults"),
      };
    } catch (error) {
      return { ok: false, message: describeFailureForPerson(error) };
    }
  }
}
