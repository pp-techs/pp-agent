import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  PROVIDER_APIS,
  type ListModelsRequest,
  type ProviderConfig,
  type ProviderSettingsView,
  type SaveProviderSettings,
} from "@workspace/shared";
import { app, safeStorage } from "electron";

interface StoredSettings {
  api: ProviderConfig["api"];
  baseUrl: string;
  modelId: string;
  /** Encrypted with the OS keychain via safeStorage, base64. */
  apiKey: string;
}

const SETTINGS_FILE = join(app.getPath("userData"), "provider.json");

function read(): StoredSettings | null {
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as StoredSettings;
  } catch {
    return null;
  }
}

function write(stored: StoredSettings): void {
  writeFileSync(SETTINGS_FILE, JSON.stringify(stored, null, 2), { mode: 0o600 });
}

async function decryptKey(stored: StoredSettings): Promise<string> {
  if (!stored.apiKey) return "";
  const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(
    Buffer.from(stored.apiKey, "base64"),
  );
  // The OS rotated the key; store it under the new one so it keeps decrypting.
  if (shouldReEncrypt) {
    write({ ...stored, apiKey: (await safeStorage.encryptStringAsync(result)).toString("base64") });
  }
  return result;
}

function view(stored: StoredSettings): ProviderSettingsView {
  return {
    api: stored.api,
    baseUrl: stored.baseUrl,
    modelId: stored.modelId,
    hasApiKey: stored.apiKey !== "",
  };
}

export function getSettingsView(): ProviderSettingsView | null {
  const stored = read();
  return stored ? view(stored) : null;
}

/** Full config including the decrypted key; only ever sent to the agent process. */
export async function getProviderConfig(): Promise<ProviderConfig | null> {
  const stored = read();
  if (!stored) return null;
  return {
    api: stored.api,
    baseUrl: stored.baseUrl,
    modelId: stored.modelId,
    apiKey: await decryptKey(stored),
  };
}

export async function saveSettings(input: SaveProviderSettings): Promise<ProviderSettingsView> {
  if (!PROVIDER_APIS.includes(input.api)) throw new Error(`Unsupported API: ${input.api}`);
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const modelId = input.modelId.trim();
  if (!modelId) throw new Error("Choose a model.");
  if (!(await safeStorage.isAsyncEncryptionAvailable()))
    throw new Error("Secure storage is not available on this computer.");

  const previous = read();
  const apiKey =
    input.apiKey !== undefined && input.apiKey !== ""
      ? (await safeStorage.encryptStringAsync(input.apiKey.trim())).toString("base64")
      : (previous?.apiKey ?? "");
  const stored: StoredSettings = { api: input.api, baseUrl, modelId, apiKey };
  write(stored);
  return view(stored);
}

/** Lists model ids from an OpenAI-compatible `GET /models`. Runs here because the renderer has no network access to the gateway. */
export async function listModels(request: ListModelsRequest): Promise<string[]> {
  const baseUrl = normalizeBaseUrl(request.baseUrl);
  const stored = read();
  const apiKey = request.apiKey || (stored ? await decryptKey(stored) : "");
  const response = await fetch(`${baseUrl}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`The gateway answered ${response.status} ${response.statusText}.`);
  const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
  return (body.data ?? [])
    .map((model) => model.id)
    .filter((id): id is string => typeof id === "string")
    .sort((a, b) => a.localeCompare(b));
}

function normalizeBaseUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("The gateway URL must use http or https.");
  return url.toString().replace(/\/+$/, "");
}
