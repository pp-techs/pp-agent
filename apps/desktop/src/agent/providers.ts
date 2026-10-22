import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Api, AuthEvent, AuthInteraction, Model } from "@earendil-works/pi-ai";
import type {
  GatewayApi,
  GatewayConfig,
  ModelRef,
  ModelSummary,
  ProviderSummary,
} from "@workspace/shared";
import type { AuthPrompts } from "./auth-prompts.ts";
import { emit, send } from "./ipc.ts";

type ProviderConfigInput = Parameters<ModelRuntime["registerProvider"]>[1];

const GATEWAY_PREFIX = "gw-";
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Trims and validates a gateway URL. Anthropic clients append `/v1/messages` themselves, so a
 * trailing `/v1` is dropped for them; OpenAI-compatible URLs keep it (they append `/chat/completions`).
 */
export function normalizeBaseUrl(api: GatewayApi, raw: string): string {
  const trimmed = raw.trim();
  if (!URL.canParse(trimmed))
    throw new Error("Enter the gateway's full address, starting with https://.");
  const url = new URL(trimmed);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("The gateway URL must use http or https.");
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

function gatewayProvider(gateway: GatewayConfig): ProviderConfigInput {
  return {
    name: gateway.name,
    baseUrl: gateway.baseUrl,
    api: gateway.api,
    models: gateway.models.map((model) => ({
      id: model.id,
      name: model.name?.trim() || model.id,
      api: gateway.api,
      reasoning: model.reasoning ?? false,
      input: model.images === false ? ["text"] : ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.contextWindow ?? 128_000,
      maxTokens: model.maxTokens ?? 16_384,
    })),
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
      runtime.registerProvider(gateway.id, gatewayProvider(gateway));
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

/**
 * Lists model ids a gateway offers. OpenAI-compatible: `GET {base}/models` with a Bearer key.
 * Anthropic: `GET {base}/v1/models` with `x-api-key`. Runs here because the renderer has no network
 * access to the gateway.
 */
export async function fetchGatewayModels(
  api: GatewayApi,
  baseUrl: string,
  apiKey: string,
): Promise<string[]> {
  const anthropic = api === "anthropic-messages";
  const headers: Record<string, string> = anthropic
    ? { "anthropic-version": "2023-06-01", ...(apiKey ? { "x-api-key": apiKey } : {}) }
    : apiKey
      ? { Authorization: `Bearer ${apiKey}` }
      : {};
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${anthropic ? "/v1/models" : "/models"}`, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `The gateway could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok)
    throw new Error(`The gateway answered ${response.status} ${response.statusText}.`.trim());
  const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
  const ids = (body.data ?? [])
    .map((model) => model.id)
    .filter((id): id is string => typeof id === "string");
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
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

/** Available models (configured providers only), by provider name then model name. */
export async function availableModels(runtime: ModelRuntime): Promise<ModelSummary[]> {
  const models = await runtime.getAvailable();
  return models
    .map((model) => summarizeModel(runtime, model))
    .sort((a, b) => a.providerName.localeCompare(b.providerName) || a.name.localeCompare(b.name));
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
      return "Saved key";
    case "environment":
      return status.label ?? "Environment variable";
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
          send({ kind: "open_url", url: event.url });
          info(event.instructions ?? "Continue in your browser.", event.url);
          break;
        case "device_code":
          info(`Enter the code ${event.userCode} on the page that opens.`, event.verificationUri);
          break;
      }
    },
  };
}
