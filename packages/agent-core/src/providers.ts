import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Api, AuthEvent, AuthInteraction, Model } from "@earendil-works/pi-ai";
import type {
  FetchedGatewayModel,
  GatewayApi,
  GatewayConfig,
  ModelRef,
  ModelSummary,
  ProviderSummary,
} from "@workspace/shared";
import type { AuthPrompts } from "./auth-prompts.ts";
import { t } from "./i18n.ts";
import { emit, openUrl } from "./ipc.ts";

type ProviderConfigInput = Parameters<ModelRuntime["registerProvider"]>[1];

const GATEWAY_PREFIX = "gw-";
const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;
/**
 * Literal `apiKey` for gateways that need none (Ollama, LM Studio, vLLM). Pi only treats a provider
 * as configured when it has a credential, and sends this value as the bearer token. A key saved in
 * the vault takes precedence over it.
 */
const KEYLESS_PLACEHOLDER_KEY = "not-needed";

/**
 * Trims and validates a gateway URL. Anthropic clients append `/v1/messages` themselves, so a
 * trailing `/v1` is dropped for them; OpenAI-compatible URLs keep it (they append `/chat/completions`).
 */
export function normalizeBaseUrl(api: GatewayApi, raw: string): string {
  const trimmed = raw.trim();
  if (!URL.canParse(trimmed)) throw new Error(t("gateways.addressInvalid"));
  const url = new URL(trimmed);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error(t("gateways.addressProtocol"));
  const base = url.toString().replace(/\/+$/, "");
  return api === "anthropic-messages" ? base.replace(/\/v1$/, "") : base;
}

/** `gw-<slug of name>`, with a number appended when another gateway already uses it. */
export function newGatewayId(name: string, taken: ReadonlySet<string>): string {
  const slug =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "gateway";
  let id = `${GATEWAY_PREFIX}${slug}`;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${GATEWAY_PREFIX}${slug}-${suffix}`;
  return id;
}

/** Pi's built-in provider whose models a gateway of this API most likely serves. */
const PREFERRED_PROVIDER: Record<GatewayApi, string> = {
  "openai-completions": "openai",
  "openai-responses": "openai",
  "anthropic-messages": "anthropic",
};

/**
 * Looks a model up by id in Pi's built-in catalog (offline), for limits the gateway does not
 * report. Gateways that prefix ids with the vendor (`anthropic/claude-…`) match on the bare id.
 * The same model can appear under several providers with different limits, so the provider
 * matching the gateway's API wins.
 */
function catalogLookup(
  runtime: ModelRuntime,
  api: GatewayApi,
): (id: string) => Model<Api> | undefined {
  const preferred = PREFERRED_PROVIDER[api];
  const builtin = runtime
    .getModels()
    .filter((model) => !model.provider.startsWith(GATEWAY_PREFIX))
    .sort((a, b) => Number(b.provider === preferred) - Number(a.provider === preferred));
  const byId = new Map<string, Model<Api>>();
  for (const model of builtin) if (!byId.has(model.id)) byId.set(model.id, model);
  return (id) => byId.get(id) ?? byId.get(id.slice(id.lastIndexOf("/") + 1));
}

function gatewayProvider(
  gateway: GatewayConfig,
  lookup: (id: string) => Model<Api> | undefined,
): ProviderConfigInput {
  return {
    name: gateway.name,
    baseUrl: gateway.baseUrl,
    api: gateway.api,
    ...(gateway.requiresApiKey ? {} : { apiKey: KEYLESS_PLACEHOLDER_KEY }),
    models: gateway.models.map((model) => {
      const known = lookup(model.id);
      return {
        id: model.id,
        name: model.name?.trim() || known?.name || model.id,
        api: gateway.api,
        reasoning: model.reasoning ?? known?.reasoning ?? false,
        input:
          (model.images ?? known?.input.includes("image") ?? true) ? ["text", "image"] : ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: model.contextWindow ?? known?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
        maxTokens: model.maxTokens ?? known?.maxTokens ?? DEFAULT_MAX_TOKENS,
      };
    }),
  };
}

/**
 * Registers every gateway with the runtime and drops gateways that no longer exist. Resolves with
 * the registered ids once the availability snapshot includes the change. A gateway is unregistered
 * before it is registered again, because re-registration merges with the previous config.
 */
export async function syncGateways(
  runtime: ModelRuntime,
  gateways: readonly GatewayConfig[],
  registered: ReadonlySet<string>,
): Promise<Set<string>> {
  const next = new Set(gateways.map((gateway) => gateway.id));
  for (const id of registered) {
    if (!next.has(id)) runtime.unregisterProvider(id);
  }
  for (const gateway of gateways) {
    if (registered.has(gateway.id)) runtime.unregisterProvider(gateway.id);
    try {
      runtime.registerProvider(
        gateway.id,
        gatewayProvider(gateway, catalogLookup(runtime, gateway.api)),
      );
    } catch (error) {
      next.delete(gateway.id);
      console.error(`Gateway ${gateway.name} could not be registered:`, error);
    }
  }
  // (Un)registering starts a background `refresh()` whose availability pass supersedes any pass
  // already running, and a superseded `getAvailable()` resolves with the old snapshot. Run a refresh
  // of our own, then queue the newest pass so the snapshot reflects every gateway.
  await runtime.refresh({ allowNetwork: false });
  await runtime.getAvailable();
  return next;
}

/** A positive whole number, or undefined. */
function tokens(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined;
}

/**
 * Lists the models a gateway offers, with their context window and reply limit. OpenAI-compatible:
 * `GET {base}/models` with a Bearer key. Anthropic: `GET {base}/v1/models` with `x-api-key`
 * (`limit=1000`; the default page holds 20). Gateways report limits under different names
 * (Anthropic `max_input_tokens`, OpenRouter `context_length`, vLLM `max_model_len`, …); what a
 * gateway leaves out comes from Pi's catalog. Runs here because the renderer has no network
 * access to the gateway.
 */
export async function fetchGatewayModels(
  runtime: ModelRuntime,
  api: GatewayApi,
  baseUrl: string,
  apiKey: string,
): Promise<FetchedGatewayModel[]> {
  const anthropic = api === "anthropic-messages";
  const headers: Record<string, string> = anthropic
    ? { "anthropic-version": "2023-06-01", ...(apiKey ? { "x-api-key": apiKey } : {}) }
    : apiKey
      ? { Authorization: `Bearer ${apiKey}` }
      : {};
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${anthropic ? "/v1/models?limit=1000" : "/models"}`, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      t("gateways.unreachable", { error: error instanceof Error ? error.message : String(error) }),
    );
  }
  if (!response.ok)
    throw new Error(
      t("gateways.badResponse", { status: `${response.status} ${response.statusText}`.trim() }),
    );
  const body = (await response.json()) as { data?: Array<Record<string, unknown>> };
  const lookup = catalogLookup(runtime, api);
  const models = new Map<string, FetchedGatewayModel>();
  for (const entry of body.data ?? []) {
    const id = entry.id;
    if (typeof id !== "string" || models.has(id)) continue;
    const known = lookup(id);
    const top = entry.top_provider as { max_completion_tokens?: unknown } | undefined;
    const model: FetchedGatewayModel = { id };
    const contextWindow =
      tokens(entry.max_input_tokens) ??
      tokens(entry.context_length) ??
      tokens(entry.context_window) ??
      tokens(entry.max_model_len) ??
      tokens(entry.max_context_length) ??
      tokens(entry.inputTokenLimit) ??
      tokens(known?.contextWindow);
    const maxTokens =
      tokens(entry.max_tokens) ??
      tokens(entry.max_output_tokens) ??
      tokens(entry.max_completion_tokens) ??
      tokens(top?.max_completion_tokens) ??
      tokens(known?.maxTokens);
    if (contextWindow) model.contextWindow = contextWindow;
    if (maxTokens) model.maxTokens = maxTokens;
    // OpenRouter reports modalities and reasoning support directly; other gateways leave these out
    // and Pi's catalog is the only source left.
    const modalities = (entry.architecture as { input_modalities?: unknown } | undefined)
      ?.input_modalities;
    const reasoning =
      (typeof entry.supported_parameters === "object" &&
        Array.isArray(entry.supported_parameters) &&
        entry.supported_parameters.includes("reasoning")) ||
      known?.reasoning;
    const images = Array.isArray(modalities)
      ? modalities.includes("image")
      : known?.input.includes("image");
    if (reasoning !== undefined) model.reasoning = Boolean(reasoning);
    if (images !== undefined) model.images = images;
    // Anthropic sends `display_name`, OpenRouter `name`. Gemini's `models/<id>` is an id, not a name.
    const name = [entry.display_name, entry.name]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .find((value) => value && value !== id && !(value.includes("/") && !/\s/.test(value)));
    if (name) model.name = name;
    models.set(id, model);
  }
  return [...models.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function summarizeModel(runtime: ModelRuntime, model: Model<Api>): ModelSummary {
  return {
    provider: model.provider,
    modelId: model.id,
    providerName: runtime.getProvider(model.provider)?.name ?? model.provider,
    name: model.name || model.id,
    reasoning: model.reasoning,
    images: model.input.includes("image"),
    contextWindow: model.contextWindow,
  };
}

/**
 * Available models, then the models of gateways that need an API key and have none (marked
 * `needsKey`, not selectable), by provider name then model name.
 */
export async function availableModels(
  runtime: ModelRuntime,
  gatewayIds: ReadonlySet<string>,
): Promise<ModelSummary[]> {
  const available = await runtime.getAvailable();
  const summaries = available.map((model) => summarizeModel(runtime, model));
  for (const id of gatewayIds) {
    if (runtime.hasConfiguredAuth(id)) continue;
    for (const model of runtime.getModels(id)) {
      summaries.push({ ...summarizeModel(runtime, model), needsKey: true });
    }
  }
  return summaries.sort(
    (a, b) => a.providerName.localeCompare(b.providerName) || a.name.localeCompare(b.name),
  );
}

/** Name of the gateway `ref` points at when that gateway needs an API key and has none. */
export function gatewayNeedingKey(
  runtime: ModelRuntime,
  gatewayIds: ReadonlySet<string>,
  ref: ModelRef | null,
): string | undefined {
  if (!ref || !gatewayIds.has(ref.provider) || runtime.hasConfiguredAuth(ref.provider)) {
    return undefined;
  }
  if (!runtime.getModels(ref.provider).some((model) => model.id === ref.modelId)) return undefined;
  return runtime.getProvider(ref.provider)?.name ?? ref.provider;
}

/** The model `ref` points at when it is still usable, else undefined. */
export function findAvailable(runtime: ModelRuntime, ref: ModelRef | null): Model<Api> | undefined {
  if (!ref) return undefined;
  return runtime
    .getAvailableSnapshot()
    .find((model) => model.provider === ref.provider && model.id === ref.modelId);
}

function authSource(runtime: ModelRuntime, providerId: string): string | undefined {
  const status = runtime.getProviderAuthStatus(providerId);
  if (!status.configured) return undefined;
  switch (status.source) {
    case "stored":
    case "runtime":
      return t("providers.savedKey");
    case "environment":
      return status.label ?? t("providers.environmentVariable");
    case "fallback":
      // Only keyless gateways register a literal key (the placeholder); never show it.
      return t("providers.noKeyNeeded");
    default:
      return status.label;
  }
}

/**
 * Built-in providers people can sign in to with an API key (plus any configured some other way, such
 * as an environment variable) and the gateways, configured ones first.
 */
export async function listProviders(
  runtime: ModelRuntime,
  gatewayIds: ReadonlySet<string>,
): Promise<ProviderSummary[]> {
  // Refreshes the availability snapshot that `hasConfiguredAuth` reads.
  await runtime.getAvailable();
  const summaries: ProviderSummary[] = [];
  for (const provider of runtime.getProviders()) {
    const gateway = gatewayIds.has(provider.id);
    const configured = runtime.hasConfiguredAuth(provider.id);
    if (!gateway && !configured && !provider.auth.apiKey?.login) continue;
    summaries.push({
      id: provider.id,
      name: provider.name,
      kind: gateway ? "gateway" : "builtin",
      configured,
      authSource: authSource(runtime, provider.id),
      modelCount: runtime.getModels(provider.id).length,
    });
  }
  return summaries.sort(
    (a, b) => Number(b.configured) - Number(a.configured) || a.name.localeCompare(b.name),
  );
}

/** Pi's sign-in interaction, routed to the renderer as `auth_prompt` / `auth_info` events. */
export function authInteraction(prompts: AuthPrompts, flowTitle: string): AuthInteraction {
  const info = (message: string, url?: string) =>
    emit({ type: "auth_info", flowTitle, message, ...(url ? { url } : {}) });
  return {
    async prompt(prompt) {
      const value = await prompts.ask(
        {
          flowTitle,
          kind: prompt.type,
          message: prompt.message,
          ...(prompt.type !== "select" && prompt.placeholder
            ? { placeholder: prompt.placeholder }
            : {}),
          ...(prompt.type === "select" ? { options: [...prompt.options] } : {}),
        },
        prompt.signal,
      );
      if (value === null) {
        prompt.signal?.throwIfAborted();
        throw new Error("Cancelled");
      }
      return value;
    },
    notify(event: AuthEvent) {
      switch (event.type) {
        case "info":
          info(event.message, event.links?.[0]?.url);
          break;
        case "progress":
          info(event.message);
          break;
        case "auth_url":
          openUrl(event.url);
          info(event.instructions ?? t("providers.continueInBrowser"), event.url);
          break;
        case "device_code":
          info(t("providers.enterCode", { code: event.userCode }), event.verificationUri);
          break;
      }
    },
  };
}
