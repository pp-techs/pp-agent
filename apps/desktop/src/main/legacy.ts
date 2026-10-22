import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GATEWAY_APIS, type GatewayApi, type SettingsFile } from "@workspace/shared";
import { app, safeStorage } from "electron";
import { storeCredential } from "./vault.ts";

/** Single-gateway settings written by earlier versions. */
interface LegacyProviderFile {
  api: GatewayApi;
  baseUrl: string;
  modelId: string;
  /** Encrypted with safeStorage, base64; empty when no key was saved. */
  apiKey: string;
}

const LEGACY_FILE = join(app.getPath("userData"), "provider.json");
const GATEWAY_ID = "gw-gateway";

/**
 * Turns the old `provider.json` into a gateway in `settings.json` plus a vault entry, once, before
 * the agent starts. `settings.json` is only created when it does not exist yet.
 */
export async function migrateLegacyProvider(settingsFile: string): Promise<void> {
  let legacy: LegacyProviderFile;
  try {
    legacy = JSON.parse(await readFile(LEGACY_FILE, "utf8")) as LegacyProviderFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      console.error("Could not read the old provider settings:", error);
    return;
  }

  const api: GatewayApi = GATEWAY_APIS.includes(legacy.api) ? legacy.api : "openai-completions";
  if (!existsSync(settingsFile) && legacy.baseUrl && legacy.modelId) {
    // The agent process adds the default agent and the remaining defaults when it loads the file.
    const settings: Omit<SettingsFile, "agents" | "activeAgentId" | "thinkingLevel"> = {
      defaultModel: { provider: GATEWAY_ID, modelId: legacy.modelId },
      shellEnabled: false,
      toolPolicies: {},
      disabledSkills: [],
      gateways: [
        {
          id: GATEWAY_ID,
          name: "Gateway",
          api,
          baseUrl: legacy.baseUrl,
          models: [{ id: legacy.modelId }],
        },
      ],
    };
    await writeFile(settingsFile, JSON.stringify(settings, null, 2), { mode: 0o600 });
  }

  if (legacy.apiKey) {
    try {
      const { result } = await safeStorage.decryptStringAsync(Buffer.from(legacy.apiKey, "base64"));
      if (result) await storeCredential(GATEWAY_ID, { type: "api_key", key: result });
    } catch (error) {
      // The key is lost; the person enters it again in Settings › Models.
      console.error("Could not move the saved gateway key:", error);
    }
  }
  await rm(LEGACY_FILE, { force: true });
}
