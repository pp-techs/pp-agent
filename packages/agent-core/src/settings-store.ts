import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_SHORTCUT,
  GATEWAY_APIS,
  isValidAccelerator,
  LANGUAGE_SETTINGS,
  type SettingsFile,
  THINKING_LEVELS,
  type ThinkingLevel,
  TOOL_POLICIES,
} from "@workspace/shared";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { emptyWebSearchConfig, readWebSearchConfig } from "./web/config.ts";
import { readAgents } from "./agents.ts";
import { type LegacyInstructions, legacyInstructions, readWorkspaces } from "./workspaces.ts";
import { readScheduledTasks } from "./scheduled-tasks.ts";
import { DEFAULT_VOICE, readVoiceSettings } from "./transcription.ts";
import { readChannelsSettings } from "./channels/settings.ts";
import { readBrowserProfiles } from "./browser-profiles.ts";

const ModelRefSchema = Type.Object({ provider: Type.String(), modelId: Type.String() });
const GatewaySchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String(),
  api: Type.Union(GATEWAY_APIS.map((api) => Type.Literal(api))),
  baseUrl: Type.String(),
  requiresApiKey: Type.Optional(Type.Boolean()),
  models: Type.Array(
    Type.Object({
      id: Type.String({ minLength: 1 }),
      name: Type.Optional(Type.String()),
      reasoning: Type.Optional(Type.Boolean()),
      images: Type.Optional(Type.Boolean()),
      contextWindow: Type.Optional(Type.Number()),
      maxTokens: Type.Optional(Type.Number()),
    }),
  ),
});
const PolicySchema = Type.Union(TOOL_POLICIES.map((policy) => Type.Literal(policy)));

/**
 * Reads a settings file field by field, so one malformed value (say, a hand-edited gateway) falls
 * back to its default without discarding the rest. Files from before agents existed get the
 * default agent.
 */
function parse(raw: unknown): SettingsFile {
  const settings: SettingsFile = {
    defaultModel: null,
    shellEnabled: false,
    toolPolicies: {},
    disabledSkills: [],
    gateways: [],
    agents: readAgents(null),
    workspaces: readWorkspaces(null, readAgents(null), null),
    activeAgentId: DEFAULT_AGENT_ID,
    thinkingLevel: "off",
    language: "system",
    notifications: true,
    tray: false,
    shortcutEnabled: false,
    shortcut: DEFAULT_SHORTCUT,
    webSearch: emptyWebSearchConfig(),
    pinnedSessions: [],
    scheduledTasks: [],
    voice: { ...DEFAULT_VOICE },
    channels: readChannelsSettings(null),
    memoryEnabled: true,
    browserProfiles: readBrowserProfiles(null),
  };
  if (typeof raw !== "object" || raw === null) return settings;
  const value = raw as Partial<Record<keyof SettingsFile, unknown>>;
  if (Value.Check(ModelRefSchema, value.defaultModel)) settings.defaultModel = value.defaultModel;
  settings.shellEnabled = value.shellEnabled === true;
  settings.notifications = value.notifications !== false;
  settings.tray = value.tray === true;
  settings.shortcutEnabled = value.shortcutEnabled === true;
  if (typeof value.shortcut === "string" && isValidAccelerator(value.shortcut))
    settings.shortcut = value.shortcut;
  settings.language = LANGUAGE_SETTINGS.find((language) => language === value.language) ?? "system";
  if (typeof value.toolPolicies === "object" && value.toolPolicies !== null) {
    for (const [name, policy] of Object.entries(value.toolPolicies)) {
      if (Value.Check(PolicySchema, policy)) settings.toolPolicies[name] = policy;
    }
  }
  if (Array.isArray(value.disabledSkills))
    settings.disabledSkills = value.disabledSkills.filter((name) => typeof name === "string");
  if (Array.isArray(value.gateways))
    settings.gateways = value.gateways
      .filter((gateway) => Value.Check(GatewaySchema, gateway))
      // Files from before keyless gateways have no flag: those gateways need a key.
      .map((gateway) => ({ ...gateway, requiresApiKey: gateway.requiresApiKey !== false }));
  settings.agents = readAgents(value.agents);
  // Files from before workspaces carry each agent's folder; they become workspaces here.
  settings.workspaces = readWorkspaces(value.workspaces, settings.agents, value.agents);
  const activeAgentId = value.activeAgentId;
  if (
    typeof activeAgentId === "string" &&
    settings.agents.some((agent) => agent.id === activeAgentId)
  )
    settings.activeAgentId = activeAgentId;
  if (THINKING_LEVELS.includes(value.thinkingLevel as ThinkingLevel))
    settings.thinkingLevel = value.thinkingLevel as ThinkingLevel;
  settings.webSearch = readWebSearchConfig(value.webSearch);
  if (Array.isArray(value.pinnedSessions))
    settings.pinnedSessions = [
      ...new Set(value.pinnedSessions.filter((name) => typeof name === "string")),
    ];
  settings.scheduledTasks = readScheduledTasks(value.scheduledTasks);
  settings.voice = readVoiceSettings(value.voice);
  settings.channels = readChannelsSettings(value.channels);
  settings.memoryEnabled = value.memoryEnabled !== false;
  settings.browserProfiles = readBrowserProfiles(value.browserProfiles);
  return settings;
}

/** App settings (`AgentPaths.settingsFile`), owned by this process. */
export class SettingsStore {
  private current: SettingsFile;
  /** Workspace instructions an older file kept here; they move into the folders' AGENTS.md. */
  readonly legacyInstructions: LegacyInstructions[];

  constructor(private readonly path: string) {
    let raw: unknown = null;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        console.error("settings.json could not be read; using defaults.", error);
    }
    this.current = parse(raw);
    this.legacyInstructions = legacyInstructions(
      (raw as { workspaces?: unknown } | null)?.workspaces,
    );
  }

  get(): SettingsFile {
    return this.current;
  }

  /** Applies `change` to a copy and saves it. Synchronous, so two updates never interleave. */
  update(change: (draft: SettingsFile) => void): SettingsFile {
    const draft = structuredClone(this.current);
    change(draft);
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, JSON.stringify(draft, null, 2), { mode: 0o600 });
    renameSync(temp, this.path);
    this.current = draft;
    return draft;
  }
}
