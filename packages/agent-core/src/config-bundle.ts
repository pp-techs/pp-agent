/**
 * Configuration bundles: the app setup an admin hands out to many people, or drops as
 * `settings.import.json` next to settings.json for unattended setup. A bundle carries gateways and
 * their default models, agents, MCP servers, tool policies and the general switches, and skills
 * lists — never secrets: gateway keys and channel tokens stay in each machine's vault, under the
 * ids the bundle references. Applying one merges it: fields it carries win, everything else stays,
 * and applying the same bundle twice changes nothing.
 */
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  type ConfigBundle,
  type ConfigBundleFile,
  type ConfigImportReport,
  LANGUAGE_SETTINGS,
  type SettingsFile,
  THINKING_LEVELS,
  type ThinkingLevel,
} from "@workspace/shared";
import { modelRef, newAgentId, readPortableAgents } from "./agents.ts";
import { t } from "./i18n.ts";
import type { McpConfigEntry, McpConfigFile } from "./mcp.ts";
import { readGateways, readToolPolicies, type SettingsStore } from "./settings-store.ts";

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The JSON text of a `ConfigBundleFile` of the given setup; secrets are not in it. */
export function exportConfigBundle(settings: SettingsFile, mcp: readonly McpConfigEntry[]): string {
  const config: ConfigBundle = {
    gateways: settings.gateways,
    defaultModel: settings.defaultModel,
    fastModel: settings.fastModel,
    thinkingLevel: settings.thinkingLevel,
    // Ids are machine-specific; the merge matches agents by name.
    agents: settings.agents.map(({ id: _id, ...agent }) => agent),
    mcpServers: Object.fromEntries(mcp.map((entry) => [entry.settings.name, entry.raw])),
    toolPolicies: settings.toolPolicies,
    shellEnabled: settings.shellEnabled,
    yoloMode: settings.yoloMode,
    language: settings.language,
    disabledSkills: settings.disabledSkills,
    trustedSkillFolders: settings.trustedSkillFolders,
  };
  const file: ConfigBundleFile = { ppAgentConfig: 1, config };
  return JSON.stringify(file, null, 2);
}

/**
 * The bundle of a `ConfigBundleFile`'s JSON text. Fields that are absent or malformed are left out
 * of the result, so an applied bundle never changes what it does not carry.
 */
export function parseConfigBundle(json: string): ConfigBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(t("config.notJson"));
  }
  const file = asObject(parsed);
  const config = asObject(file?.config);
  if (file?.ppAgentConfig !== 1 || !config) throw new Error(t("config.notBundle"));
  const bundle: ConfigBundle = {};
  if (config.gateways !== undefined) bundle.gateways = readGateways(config.gateways);
  for (const key of ["defaultModel", "fastModel"] as const) {
    if (config[key] === null) bundle[key] = null;
    const ref = modelRef(config[key]);
    if (ref) bundle[key] = ref;
  }
  if (THINKING_LEVELS.includes(config.thinkingLevel as ThinkingLevel))
    bundle.thinkingLevel = config.thinkingLevel as ThinkingLevel;
  if (config.agents !== undefined) bundle.agents = readPortableAgents(config.agents);
  const mcpServers = asObject(config.mcpServers);
  if (mcpServers)
    bundle.mcpServers = Object.fromEntries(
      Object.entries(mcpServers).filter((entry) => asObject(entry[1])),
    );
  if (config.toolPolicies !== undefined)
    bundle.toolPolicies = readToolPolicies(config.toolPolicies);
  if (typeof config.shellEnabled === "boolean") bundle.shellEnabled = config.shellEnabled;
  if (typeof config.yoloMode === "boolean") bundle.yoloMode = config.yoloMode;
  const language = LANGUAGE_SETTINGS.find((entry) => entry === config.language);
  if (language) bundle.language = language;
  if (Array.isArray(config.disabledSkills))
    bundle.disabledSkills = [
      ...new Set(config.disabledSkills.filter((name): name is string => typeof name === "string")),
    ];
  if (Array.isArray(config.trustedSkillFolders))
    bundle.trustedSkillFolders = [
      ...new Set(
        config.trustedSkillFolders.filter(
          (folder): folder is string => typeof folder === "string" && isAbsolute(folder),
        ),
      ),
    ];
  return bundle;
}

/**
 * Applies `bundle` to a settings draft and says how much it changed. Agents merge by name
 * (case-insensitive) and keep their local id; gateways by id, so a key already saved in the vault
 * under that id keeps working. The MCP servers merge separately, in mcp.json.
 */
export function mergeConfigBundle(draft: SettingsFile, bundle: ConfigBundle): ConfigImportReport {
  const report: ConfigImportReport = {
    gateways: 0,
    agents: 0,
    mcpServers: 0,
    toolPolicies: 0,
    settings: 0,
    disabledSkills: 0,
    trustedSkillFolders: 0,
  };
  for (const gateway of bundle.gateways ?? []) {
    const at = draft.gateways.findIndex((entry) => entry.id === gateway.id);
    if (at >= 0) draft.gateways[at] = gateway;
    else draft.gateways.push(gateway);
    report.gateways += 1;
  }
  for (const incoming of bundle.agents ?? []) {
    const existing = draft.agents.find(
      (agent) => agent.name.toLocaleLowerCase() === incoming.name.toLocaleLowerCase(),
    );
    if (existing) Object.assign(existing, incoming);
    else draft.agents.push({ ...incoming, id: newAgentId(draft.agents, incoming.name) });
    report.agents += 1;
  }
  for (const [tool, policy] of Object.entries(bundle.toolPolicies ?? {})) {
    draft.toolPolicies[tool] = policy;
    report.toolPolicies += 1;
  }
  if (bundle.defaultModel !== undefined) {
    draft.defaultModel = bundle.defaultModel;
    report.settings += 1;
  }
  if (bundle.fastModel !== undefined) {
    draft.fastModel = bundle.fastModel;
    report.settings += 1;
  }
  if (bundle.thinkingLevel !== undefined) {
    draft.thinkingLevel = bundle.thinkingLevel;
    report.settings += 1;
  }
  if (bundle.shellEnabled !== undefined) {
    draft.shellEnabled = bundle.shellEnabled;
    report.settings += 1;
  }
  if (bundle.yoloMode !== undefined) {
    draft.yoloMode = bundle.yoloMode;
    report.settings += 1;
  }
  if (bundle.language !== undefined) {
    draft.language = bundle.language;
    report.settings += 1;
  }
  if (bundle.disabledSkills) {
    draft.disabledSkills = [...new Set(bundle.disabledSkills)];
    report.disabledSkills = bundle.disabledSkills.length;
  }
  if (bundle.trustedSkillFolders) {
    draft.trustedSkillFolders = [
      ...new Set(bundle.trustedSkillFolders.filter((folder) => isAbsolute(folder))),
    ];
    report.trustedSkillFolders = draft.trustedSkillFolders.length;
  }
  return report;
}

/** The file a setup script or MDM drops next to settings.json to configure the app unattended. */
export const CONFIG_DROP_FILE = "settings.import.json";

/**
 * Applies and removes the dropped configuration bundle in `folder`, when there is one; returns what
 * it changed, or null when there was no bundle. A bundle that does not apply is kept aside as
 * `settings.import.json.failed` — the next start does not retry it — and reported to the person.
 */
export function applyDroppedConfig(
  settings: SettingsStore,
  mcp: McpConfigFile,
  folder: string,
  failed: (message: string) => void,
): ConfigImportReport | null {
  const path = join(folder, CONFIG_DROP_FILE);
  if (!existsSync(path)) return null;
  try {
    const bundle = parseConfigBundle(readFileSync(path, "utf8"));
    let report!: ConfigImportReport;
    settings.update((draft) => {
      report = mergeConfigBundle(draft, bundle);
    });
    report.mcpServers = mcp.mergeServers(bundle.mcpServers);
    rmSync(path, { force: true });
    return report;
  } catch (error) {
    try {
      renameSync(path, `${path}.failed`);
    } catch {
      // The folder may be read-only; the message below still says what happened.
    }
    failed(
      t("config.dropFailed", { error: error instanceof Error ? error.message : String(error) }),
    );
    return null;
  }
}
