/**
 * Contract shared by the Electron main process, the agent utility process, and the renderer.
 * Everything crossing a process boundary is defined here so the three sides cannot drift.
 */

export * from "./accelerator.ts";

/** Approval tier of a tool, modelled on omp: reads run freely, writes and execution need a person. */
export type ToolTier = "read" | "write" | "exec";

export type ToolStatus = "running" | "awaiting-approval" | "done" | "error" | "denied";

export type ChatPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  /** Image the person attached; `data` is base64. */
  | { type: "image"; mimeType: string; data: string }
  /** File the person attached, copied into the workspace at `path`. */
  | { type: "file"; name: string; path: string }
  /** Skill the person invoked with `/skill:<name>`; any text after it follows as a text part. */
  | { type: "skill"; name: string }
  | {
      type: "tool";
      toolCallId: string;
      name: string;
      args: Record<string, unknown>;
      status: ToolStatus;
      output?: string;
    };

export interface ChatMessage {
  id: string;
  /** `compaction` marks where older messages were summarized for the model; it has no parts. */
  role: "user" | "assistant" | "compaction";
  parts: ChatPart[];
  error?: string;
  /**
   * Id of the message's entry in the saved conversation, which message actions (edit, regenerate,
   * branch) refer to. Absent while the message is still streaming.
   */
  entryId?: string;
}

export interface ApprovalRequest {
  requestId: string;
  toolCallId: string;
  /**
   * Tool call shown in the transcript that this request belongs to. Differs from `toolCallId` when
   * a tool (such as a codemode script) makes the call itself.
   */
  anchorToolCallId: string;
  toolName: string;
  tier: ToolTier;
  title: string;
  detail: string;
}

/** `unconfigured`: no model is available yet (no provider connected or no model chosen). */
export type AgentStatus = "starting" | "unconfigured" | "idle" | "running";

/** How full the open conversation's context window is. */
export interface ContextUsage {
  /** Estimated tokens in context; null right after a compaction, until the next reply. */
  tokens: number | null;
  /** Context window of the conversation's model, in tokens. */
  window: number;
}

export interface AgentSnapshot {
  status: AgentStatus;
  messages: ChatMessage[];
  approvals: ApprovalRequest[];
  /** Model of the open conversation. */
  model: ModelSummary | null;
  /** Agent of the open conversation. */
  agent: AgentSummary | null;
  /** Thinking (reasoning effort) of the open conversation; `available` is empty when its model can't think. */
  thinking: { level: ThinkingLevel; available: ThinkingLevel[] };
  /** Workspace of the open conversation. */
  workspace: WorkspaceSummary | null;
  /** Folder the open conversation works in (its workspace's folder). */
  workspaceDir: string | null;
  /** Session file of the open conversation. */
  sessionPath: string | null;
  /** Context window usage of the open conversation; null while it has no model. */
  context: ContextUsage | null;
}

/** Which settings area changed; the renderer refetches the matching query (`[scope]`). */
export type SettingsScope =
  | "settings"
  | "providers"
  | "models"
  | "tools"
  | "skills"
  | "mcp"
  | "agents"
  | "workspaces"
  | "sessions"
  | "memory"
  | "scheduledTasks"
  | "voice"
  | "background";

export type AgentEvent =
  | { type: "status"; status: AgentStatus }
  /** Insert or replace the message with this id. */
  | { type: "message"; message: ChatMessage }
  | { type: "snapshot"; snapshot: AgentSnapshot }
  | { type: "approval_requested"; request: ApprovalRequest }
  | { type: "approval_resolved"; requestId: string }
  /** The saved conversation list changed (new, renamed, deleted, or a turn finished). */
  | { type: "sessions_changed" }
  /** The open conversation's context usage changed (a reply finished, or it was compacted). */
  | { type: "context"; context: ContextUsage | null }
  | { type: "settings_changed"; scopes: SettingsScope[] }
  /** A sign-in flow (provider or MCP server) needs input from the person. */
  | { type: "auth_prompt"; prompt: AuthPrompt }
  /** The prompt was answered, cancelled, or made obsolete by the flow itself. */
  | { type: "auth_prompt_closed"; promptId: string }
  /** Progress or instructions from a sign-in flow (for example a URL that was opened). */
  | { type: "auth_info"; flowTitle: string; message: string; url?: string }
  | { type: "error"; message: string };

/** Something the person attached to a message. Exactly one of `path` or `data` is set. */
export interface Attachment {
  name: string;
  mimeType: string;
  /** File on disk (picked or dropped). */
  path?: string;
  /** Base64 contents (pasted images have no file). */
  data?: string;
}

export interface SessionSummary {
  path: string;
  /** Workspace the conversation belongs to. */
  workspaceId: string;
  title: string;
  /** Last change, epoch milliseconds. */
  modified: number;
  messageCount: number;
  /** Pinned conversations are listed first, in the sidebar's "Pinned" group. */
  pinned: boolean;
}

/** A conversation that matches a search, with where it matched. Ranges are [start, end) offsets. */
export interface SessionSearchHit {
  path: string;
  workspaceId: string;
  title: string;
  /** Where in `title` the search words occur. */
  titleMatches: Array<[number, number]>;
  /** Last change, epoch milliseconds. */
  modified: number;
  /** Excerpt of the first message that matches; empty when only the title matched. */
  snippet: string;
  /** Where in `snippet` the search words occur. */
  snippetMatches: Array<[number, number]>;
}

export const EXPORT_FORMATS = ["md", "html"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** A conversation rendered as a document, ready for the save dialog. */
export interface SessionExport {
  /** File name without extension. */
  suggestedName: string;
  content: string;
}

/** Tokens and estimated cost of the open conversation, summed over every reply the models gave. */
export interface SessionUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Estimated cost in US dollars; null when none of the replies had a known price. */
  cost: number | null;
  /** Some replies came from models without a known price, so `cost` leaves them out. */
  costPartial: boolean;
}

// ---------------------------------------------------------------------------------------------
// Models and providers
// ---------------------------------------------------------------------------------------------

/** Wire APIs a custom gateway can speak; all are supported by pi-ai. */
export const GATEWAY_APIS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
] as const;
export type GatewayApi = (typeof GATEWAY_APIS)[number];

export interface ModelRef {
  provider: string;
  modelId: string;
}

export interface ModelSummary extends ModelRef {
  providerName: string;
  name: string;
  reasoning: boolean;
  /** Accepts image input. */
  images: boolean;
  contextWindow: number;
  /** Set by `list_models` on a gateway's models when the gateway needs an API key and has none. */
  needsKey?: boolean;
}

export interface ProviderSummary {
  id: string;
  name: string;
  /** `builtin`: from pi's catalog. `gateway`: a custom endpoint added in Settings. */
  kind: "builtin" | "gateway";
  /** Has a usable credential. */
  configured: boolean;
  /** Where the credential comes from, for display ("Saved key", "OPENAI_API_KEY", …). */
  authSource?: string;
  modelCount: number;
}

export interface GatewayModel {
  id: string;
  /** Display name; defaults to `id`. */
  name?: string;
  reasoning?: boolean;
  /** Accepts image input. Default true. */
  images?: boolean;
  /** Context window in tokens. Default: the model's value in Pi's catalog, else 128000. */
  contextWindow?: number;
  /** Largest reply in tokens. Default: the model's value in Pi's catalog, else 16384. */
  maxTokens?: number;
}

export interface GatewayConfig {
  /** Provider id, assigned by the agent when the gateway is created (`gw-<slug>`). */
  id: string;
  name: string;
  api: GatewayApi;
  baseUrl: string;
  models: GatewayModel[];
  /** The gateway needs an API key. `false` for local endpoints (Ollama, LM Studio, vLLM) that take none. Absent in older files = true. */
  requiresApiKey: boolean;
}

export interface GatewayView extends GatewayConfig {
  hasApiKey: boolean;
}

export interface SaveGatewayInput {
  /** Omit to create a new gateway. */
  id?: string;
  name: string;
  api: GatewayApi;
  baseUrl: string;
  models: GatewayModel[];
  /** The gateway needs an API key (default in the editor: true). */
  requiresApiKey: boolean;
  /** Omit to keep the stored key; empty string removes it. */
  apiKey?: string;
}

/** A model a gateway listed, with the name and limits the gateway (or Pi's catalog) reports. */
export type FetchedGatewayModel = Pick<GatewayModel, "id" | "name" | "contextWindow" | "maxTokens">;

export interface FetchGatewayModelsInput {
  api: GatewayApi;
  baseUrl: string;
  /** Key to try; omit to use the key stored for `gatewayId`. */
  apiKey?: string;
  gatewayId?: string;
}

// ---------------------------------------------------------------------------------------------
// Sign-in prompts (provider API keys, MCP OAuth)
// ---------------------------------------------------------------------------------------------

export interface AuthPrompt {
  promptId: string;
  /** Title of the whole flow, e.g. "Connect Anthropic". */
  flowTitle: string;
  kind: "text" | "secret" | "select" | "manual_code";
  message: string;
  placeholder?: string;
  options?: { id: string; label: string; description?: string }[];
}

// ---------------------------------------------------------------------------------------------
// App settings, tools, skills, MCP
// ---------------------------------------------------------------------------------------------

/**
 * Per-tool behaviour. `auto`: read-only tools run freely, others ask. `ask`: always ask.
 * `allow`: never ask. `off`: the agent cannot use the tool.
 */
export const TOOL_POLICIES = ["auto", "ask", "allow", "off"] as const;
export type ToolPolicy = (typeof TOOL_POLICIES)[number];

/** Pi's thinking levels, lowest first. Models offer a subset; `off` is always offered. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** Languages the app is translated into. */
export const LANGUAGES = ["en", "vi"] as const;
export type Language = (typeof LANGUAGES)[number];
/** Settings choice: follow the operating system, or a fixed language. */
export const LANGUAGE_SETTINGS = ["system", ...LANGUAGES] as const;
export type LanguageSetting = (typeof LANGUAGE_SETTINGS)[number];

export interface AppSettings {
  /** Model for new conversations. */
  defaultModel: ModelRef | null;
  /**
   * Lets the agent run shell commands (bash, or PowerShell on Windows). Each command asks unless
   * the shell's own policy is `allow`.
   */
  shellEnabled: boolean;
  /** Language of the app; `system` follows the operating system. */
  language: LanguageSetting;
  /** Tool name → policy; tools not listed use their default. */
  toolPolicies: Record<string, ToolPolicy>;
  /** Names of installed skills the agent must not see. */
  disabledSkills: string[];
  /** Agent for new conversations: the one picked last. */
  activeAgentId: string;
  /** Thinking level for new conversations: the one picked last. */
  thinkingLevel: ThinkingLevel;
  /** Native notifications when a run finishes or needs approval while the window is not in focus. */
  notifications: boolean;
  /** Keep a tray / menu bar icon; closing the window then hides it instead of quitting. */
  tray: boolean;
  /** Register `shortcut` as a global shortcut that shows the window and focuses the message box. */
  shortcutEnabled: boolean;
  /** Electron accelerator for the global shortcut (see `isValidAccelerator`). */
  shortcut: string;
}

// ---------------------------------------------------------------------------------------------
// Agents (profiles: rules plus which tools, MCP servers, and skills they may use)
// ---------------------------------------------------------------------------------------------

/** Id of the built-in agent. It can be edited but not deleted. */
export const DEFAULT_AGENT_ID = "default";

export interface AgentSummary {
  id: string;
  name: string;
  /** One emoji. */
  icon: string;
}

export interface AgentProfile extends AgentSummary {
  description: string;
  /** Rules added to the system prompt while this agent is active. */
  instructions: string;
  /**
   * App tools (read, ls, find, grep, write, edit, bash/powershell, read_document,
   * current_datetime) it may use; null = all of them. Settings › Tools still applies on top: a tool
   * that is off there, or the shell while shell commands are off, stays unavailable.
   */
  tools: string[] | null;
  /** MCP servers (mcp.json names) it connects to; null = every enabled server. */
  mcpServers: string[] | null;
  /** Skills it may use; null = every enabled skill. */
  skills: string[] | null;
  /** Model it switches to when picked; null = keep the conversation's model / the default. */
  model: ModelRef | null;
  /** Suggestions shown on an empty chat. */
  starterPrompts: string[];
  /** Uses long-term memory (notes in the prompt, memory tools). Missing in older files = true. */
  memory: boolean;
}

/** Limits of long-term memory (per place), shared so the editor can enforce the same ones. */
export const MEMORY_LIMITS = {
  maxEntries: 200,
  maxEntryLength: 500,
  maxTagLength: 30,
  /** Characters of notes added to the system prompt; the newest notes come first. */
  maxInjectedLength: 4000,
} as const;

/** A short fact or preference the agent keeps across conversations. */
export interface MemoryEntry {
  id: string;
  text: string;
  /** One short label ("preference", "project"…); null = none. */
  tag: string | null;
  /** Where the note lives: null = every workspace, else only that workspace's conversations. */
  workspaceId: string | null;
  /** Epoch milliseconds. */
  createdAt: number;
  updatedAt: number;
}

export interface MemoryView {
  /** Global switch: off = no notes in prompts and the memory tools do nothing. */
  enabled: boolean;
  /** Most recently saved or edited first. */
  entries: MemoryEntry[];
}

/** Omit `id` to create an agent. */
export type SaveAgentInput = Omit<AgentProfile, "id"> & { id?: string };

/** File written by "Export agent". Machine-specific field (id) is left out. */
export interface AgentExportFile {
  ppAgentExport: 1;
  agent: Omit<AgentProfile, "id">;
}

// ---------------------------------------------------------------------------------------------
// Workspaces (a folder plus the defaults and rules for conversations started in it)
// ---------------------------------------------------------------------------------------------

/** Id of the built-in workspace (the app's default folder). It can be edited but not deleted. */
export const DEFAULT_WORKSPACE_ID = "default";

export interface WorkspaceSummary {
  id: string;
  name: string;
  /** One emoji. */
  icon: string;
}

export interface WorkspaceProfile extends WorkspaceSummary {
  /** Absolute folder conversations work in. Null only for the built-in workspace: the app's folder. */
  dir: string | null;
  /** Rules added to the system prompt in every conversation of this workspace. */
  instructions: string;
  /** Agent for new conversations here; null = the agent picked last. */
  agentId: string | null;
}

/** Omit `id` to create a workspace. */
export type SaveWorkspaceInput = Omit<WorkspaceProfile, "id"> & { id?: string };

/** Tools an agent can pick from in its editor (MCP tools are chosen per server). */
export interface AgentToolOption {
  name: string;
  /** Plain-English label. */
  label: string;
  description: string;
  /** Unavailable everywhere right now (off in Settings › Tools, or shell commands off). */
  globallyOff: boolean;
}

export interface ToolSummary {
  name: string;
  description: string;
  /** `built-in`, or the MCP server the tool comes from. */
  source: string;
  tier: ToolTier;
  policy: ToolPolicy;
  /** What actually happens when the agent calls the tool. */
  effective: "allow" | "ask" | "off";
  /** Policy cannot be changed here (shell tools while shell commands are off; discovery tools stay on). */
  locked: boolean;
  /** Risk the person should know about while the tool is set up this way; the renderer words it. */
  warning?: ToolWarning;
}

/** Risks the Tools page warns about; the renderer words each one. */
export type ToolWarning = "shell-unrestricted";

/** Contents of `AgentPaths.settingsFile`. */
export interface SettingsFile extends AppSettings {
  gateways: GatewayConfig[];
  /** Always contains the agent with id `DEFAULT_AGENT_ID`. */
  agents: AgentProfile[];
  /** Always contains the workspace with id `DEFAULT_WORKSPACE_ID`. */
  workspaces: WorkspaceProfile[];
  webSearch: WebSearchConfig;
  /** File names of the pinned conversations (`<id>.jsonl` inside the sessions folder). */
  pinnedSessions: string[];
  scheduledTasks: ScheduledTask[];
  voice: VoiceSettings;
  channels: ChannelsSettings;
}

// ---------------------------------------------------------------------------------------------
// Background service and chat channels
// ---------------------------------------------------------------------------------------------

export type ServiceManagerKind = "launchd" | "systemd" | "windows-task";

/** Whether the daemon is registered to start at login and keep running without the window. */
export interface ServiceStatus {
  /** False where no supported service manager exists (the reason is in `detail`). */
  supported: boolean;
  manager: ServiceManagerKind | null;
  installed: boolean;
  /** Why the service is unsupported, or the last failure, for the person to read. */
  detail: string | null;
}

/** Telegram settings in settings.json. The bot token is in the vault, never here. */
export interface TelegramSettings {
  enabled: boolean;
  /** Workspace of new Telegram conversations; the agent is the workspace's own unless pinned here. */
  workspaceId: string;
  /** Agent pinned for Telegram; null = the workspace's agent, else the built-in agent. */
  agentId: string | null;
  /** Telegram user id that paired with the bot; only this person is answered. */
  ownerId: number | null;
  ownerName: string | null;
}

export interface ChannelsSettings {
  telegram: TelegramSettings;
}

export type ChannelState = "off" | "connecting" | "online" | "error";

export interface TelegramStatus extends TelegramSettings {
  hasToken: boolean;
  /** Without the leading `@`; known once the token has been accepted by Telegram. */
  botUsername: string | null;
  state: ChannelState;
  error: string | null;
  /** One-time code to send to the bot as `/pair <code>`, while a pairing is open. */
  pairingCode: string | null;
  pairingExpiresAt: number | null;
}

export interface SaveTelegramInput {
  /** A new bot token; omitted keeps the stored one. */
  token?: string;
  enabled: boolean;
  /** null = follow the workspace's agent. */
  agentId: string | null;
  workspaceId: string;
}

// ---------------------------------------------------------------------------------------------
// Scheduled tasks (prompts that run on a schedule, without opening a chat)
// ---------------------------------------------------------------------------------------------

/** Limits shared so the editor enforces the same ones as the agent. */
export const SCHEDULE_LIMITS = {
  maxTasks: 50,
  maxNameLength: 60,
  maxPromptLength: 20_000,
  minMinutes: 5,
  maxMinutes: 1_440,
  maxHours: 168,
} as const;

/** Times are local to the computer. Weekdays are numbered like `Date.getDay()`: 0 = Sunday. */
export type TaskSchedule =
  | { kind: "interval"; every: number; unit: "minutes" | "hours" }
  | { kind: "daily"; time: string }
  | { kind: "weekly"; days: number[]; time: string };

/** How the last run of a task ended. */
export interface TaskRun {
  /** When it started, epoch milliseconds. */
  at: number;
  durationMs: number;
  status: "completed" | "failed";
  /** Why it failed, in the language of the app at the time. */
  error?: string;
  /** Tools that needed approval and were denied because nobody was there to approve. */
  deniedTools: number;
  /** The saved conversation of the run; absent when it could not start. */
  sessionPath?: string;
}

export interface ScheduledTask {
  id: string;
  /** Unique, case-insensitively. */
  name: string;
  prompt: string;
  /** Agent that runs it; a deleted agent falls back to the default agent. */
  agentId: string;
  /** Workspace it runs in; a deleted workspace falls back to the default workspace. */
  workspaceId: string;
  schedule: TaskSchedule;
  enabled: boolean;
  /** Runs are counted from here: creation, enabling, or the last schedule change (epoch ms). */
  armedAt: number;
  lastRun: TaskRun | null;
}

export type ScheduledTaskState = "idle" | "queued" | "running";

export interface ScheduledTaskView extends ScheduledTask {
  state: ScheduledTaskState;
  /** Next scheduled run, epoch milliseconds; null while disabled. */
  nextRun: number | null;
}

/** Omit `id` to create a task. */
export type SaveScheduledTaskInput = Omit<ScheduledTask, "id" | "armedAt" | "lastRun"> & {
  id?: string;
};

// ---------------------------------------------------------------------------------------------
// Voice input (speech to text for the message box)
// ---------------------------------------------------------------------------------------------

export const VOICE_LIMITS = {
  /** A recording stops by itself after this long. */
  maxDurationMs: 300_000,
  /** Largest recording the app sends (transcription services refuse about 25 MB). */
  maxBytes: 20 * 1024 * 1024,
  maxModelLength: 100,
  /** A local model can be the path of a ggml file, which is longer than a model name. */
  maxModelPathLength: 1024,
} as const;

export const DEFAULT_VOICE_MODEL = "whisper-1";

/**
 * Reserved provider id of local speech to text (whisper.cpp on this computer): no key, no
 * service, and the recording never leaves the computer.
 */
export const LOCAL_VOICE_PROVIDER = "local";

/** Local whisper.cpp models Settings can download, smallest first. */
export const VOICE_MODEL_PRESETS = ["tiny", "base", "small", "medium"] as const;
export type VoiceModelPreset = (typeof VOICE_MODEL_PRESETS)[number];

/** The model a new local voice setting starts with: fast enough, good with accents. */
export const DEFAULT_LOCAL_VOICE_MODEL: VoiceModelPreset = "base";

export function isVoiceModelPreset(value: string): value is VoiceModelPreset {
  return (VOICE_MODEL_PRESETS as readonly string[]).includes(value);
}

/** Size of each downloadable ggml file, so the person sees it before downloading. */
export const VOICE_MODEL_PRESET_BYTES: Record<VoiceModelPreset, number> = {
  tiny: 77_691_713,
  base: 147_951_465,
  small: 487_601_967,
  medium: 1_533_763_059,
};

/** Contents of `SettingsFile.voice`. */
export interface VoiceSettings {
  /** Provider or gateway id whose key pays for transcription, `local`, or null = not set up. */
  providerId: string | null;
  /** A service's model (`whisper-1`), or with `local` a preset name or a ggml file path. */
  model: string;
  /** `app` = the language of the app, `auto` = let the service detect it, or a two-letter code. */
  language: string;
}

/** A provider or gateway that can transcribe: it has a key and an OpenAI-style address. */
export interface VoiceProviderOption {
  id: string;
  name: string;
}

/** What local speech to text (whisper.cpp) can do on this computer right now. */
export interface VoiceLocalStatus {
  /** whisper.cpp's `whisper-cli` was found, bundled with the app or on the PATH. */
  binary: boolean;
  /** Which downloadable models are already in the app's models folder. */
  models: Record<VoiceModelPreset, boolean>;
  /** The ggml file the setting points at exists (a preset or a path the person gave). */
  model: boolean;
}

export interface VoiceView {
  config: VoiceSettings;
  providers: VoiceProviderOption[];
  local: VoiceLocalStatus;
  /** The chosen way to transcribe can work right now, so the mic button works. */
  ready: boolean;
}

// ---------------------------------------------------------------------------------------------
// Web search
// ---------------------------------------------------------------------------------------------

/** Search services `web_search` can use. */
export const SEARCH_PROVIDERS = ["searxng", "serper", "tavily", "brave", "exa", "webclaw"] as const;
export type SearchProviderId = (typeof SEARCH_PROVIDERS)[number];

/** Stored in settings.json. Keys are not here: they live in the encrypted vault. */
export interface WebSearchConfig {
  /** Providers in the order `web_search` tries them; the first that answers wins. */
  providers: SearchProviderId[];
  /** Base URL per provider that has one (SearXNG: required; webclaw: optional, self-hosted). */
  endpoints: Partial<Record<SearchProviderId, string>>;
}

export interface SearchProviderView {
  id: SearchProviderId;
  label: string;
  /** Takes an API key (SearXNG: optional bearer token). */
  usesKey: boolean;
  keyRequired: boolean;
  /** A key is stored in the vault. The key itself never reaches the renderer. */
  hasKey: boolean;
  /** Takes a base URL. */
  usesEndpoint: boolean;
  endpointRequired: boolean;
  endpoint: string;
  /** In the list `web_search` tries. */
  enabled: boolean;
  /** Has what it needs to run (a key and/or a URL). */
  configured: boolean;
  /** Where to get a key or set one up. */
  helpUrl: string;
}

/** Enabled providers first, in the order they are tried; then the rest. */
export interface WebSearchView {
  providers: SearchProviderView[];
}

export interface SaveWebSearchInput {
  /** Enabled providers in the order they are tried. */
  providers: SearchProviderId[];
  endpoints: Partial<Record<SearchProviderId, string>>;
  /** Provider → new key; `null` removes the stored key; a provider left out keeps its key. */
  keys: Partial<Record<SearchProviderId, string | null>>;
}

export interface WebSearchTestResult {
  ok: boolean;
  message: string;
}

export interface SkillSummary {
  name: string;
  description: string;
  enabled: boolean;
  /** Directory of the skill. */
  path: string;
  /** False when `disable-model-invocation` is set: only `/skill:<name>` loads it. */
  modelInvocable: boolean;
  /** Ships with the app and has not been edited; the app updates it with new versions. */
  builtIn: boolean;
}

export interface SkillDetail extends SkillSummary {
  /** SKILL.md without its frontmatter. */
  body: string;
  /** Other files in the skill directory, relative to it. */
  files: string[];
}

export interface SaveSkillInput {
  /** Name of the skill being edited; omit to create one. */
  originalName?: string;
  name: string;
  description: string;
  modelInvocable: boolean;
  body: string;
}

export const MCP_EXPOSURES = ["codemode", "deferred", "direct", "hidden"] as const;
export type McpExposure = (typeof MCP_EXPOSURES)[number];

/** One `mcpServers` entry of mcp.json, as edited in Settings. Unknown keys are preserved on save. */
export interface McpServerSettings {
  name: string;
  description?: string;
  enabled: boolean;
  exposure: McpExposure;
  /** Per-request timeout in seconds. */
  timeout?: number;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
}

export type McpServerState =
  | "disabled"
  | "starting"
  | "connecting"
  | "connected"
  | "failed"
  | "needs-auth"
  | "disconnected";

export interface McpServerView {
  settings: McpServerSettings;
  state: McpServerState;
  toolCount: number;
  error?: string;
  /** HTTP server without an Authorization header: can sign in with OAuth. */
  usesOAuth: boolean;
}

/** The settings a person can change with `update_settings`. */
export type SettingsPatch = Partial<
  Pick<
    AppSettings,
    | "defaultModel"
    | "shellEnabled"
    | "language"
    | "notifications"
    | "tray"
    | "shortcutEnabled"
    | "shortcut"
  >
>;

export interface McpOverview {
  servers: McpServerView[];
  /** Problems in mcp.json that kept entries from loading. */
  configErrors: string[];
  configPath: string;
  /**
   * Where MCP sign-in tokens are kept: `encrypted` in the vault, or `file` (a plain file in the
   * app folder) when the OS cannot encrypt them.
   */
  authStorage: "encrypted" | "file";
}

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

type NoParams = Record<never, never>;

export interface AgentCommandMap {
  get_snapshot: { params: NoParams; result: AgentSnapshot };
  prompt: { params: { text: string; attachments: Attachment[] }; result: void };
  abort: { params: NoParams; result: void };
  /** Without `workspaceId`: in the workspace of the open conversation. */
  new_chat: { params: { workspaceId?: string }; result: void };
  respond_approval: { params: { requestId: string; approved: boolean }; result: void };
  list_sessions: { params: NoParams; result: SessionSummary[] };
  /** Summarizes earlier messages of the open conversation to free up the model's context. */
  compact: { params: NoParams; result: void };
  open_session: { params: { path: string }; result: void };
  rename_session: { params: { path: string; name: string }; result: void };
  delete_session: { params: { path: string }; result: void };
  /** Pins or unpins a saved conversation; pinned ones are listed first. */
  pin_session: { params: { path: string; pinned: boolean }; result: void };
  /** Full-text search (ignoring case and accents) over the titles and messages of saved chats. */
  search_sessions: { params: { query: string }; result: SessionSearchHit[] };
  /** A saved conversation as a document; the renderer then asks main to save it. */
  export_session: { params: { path: string; format: ExportFormat }; result: SessionExport };
  /** Tokens and estimated cost of the open conversation. */
  get_usage: { params: NoParams; result: SessionUsage };
  /** Asks again for the last answer: drops it and the model answers the same message anew. */
  regenerate: { params: NoParams; result: void };
  /**
   * Replaces a message and everything after it, then sends the new text. `keep` lists the
   * attachments of the original message to send again: workspace-relative file paths and indexes
   * of its images; `attachments` are added.
   */
  edit_message: {
    params: {
      entryId: string;
      text: string;
      attachments: Attachment[];
      keep: { files: string[]; images: number[] };
    };
    result: void;
  };
  /** Starts a new conversation holding the chat up to and including this message, and opens it. */
  branch_session: { params: { entryId: string }; result: void };

  get_settings: { params: NoParams; result: AppSettings };
  update_settings: {
    params: { patch: SettingsPatch };
    result: AppSettings;
  };

  /** Built-in providers and gateways, configured first. */
  list_providers: { params: NoParams; result: ProviderSummary[] };
  /** Runs the provider's API-key sign-in; questions arrive as `auth_prompt` events. */
  connect_provider: { params: { providerId: string }; result: ProviderSummary };
  disconnect_provider: { params: { providerId: string }; result: void };
  respond_auth_prompt: { params: { promptId: string; value: string | null }; result: void };
  list_gateways: { params: NoParams; result: GatewayView[] };
  save_gateway: { params: { gateway: SaveGatewayInput }; result: GatewayView };
  delete_gateway: { params: { id: string }; result: void };
  fetch_gateway_models: { params: FetchGatewayModelsInput; result: FetchedGatewayModel[] };
  /** Models of every configured provider. */
  list_models: { params: NoParams; result: ModelSummary[] };
  /** Model for the open conversation (saved with it). */
  set_model: { params: ModelRef; result: void };

  list_tools: { params: NoParams; result: ToolSummary[] };
  set_tool_policy: { params: { name: string; policy: ToolPolicy }; result: void };
  list_web_search: { params: NoParams; result: WebSearchView };
  save_web_search: { params: { config: SaveWebSearchInput }; result: WebSearchView };
  /** Runs one search against a saved provider to check its key and URL. */
  test_web_search: { params: { provider: SearchProviderId }; result: WebSearchTestResult };

  list_skills: { params: NoParams; result: SkillSummary[] };
  get_skill: { params: { name: string }; result: SkillDetail };
  save_skill: { params: { skill: SaveSkillInput }; result: SkillSummary };
  delete_skill: { params: { name: string }; result: void };
  set_skill_enabled: { params: { name: string; enabled: boolean }; result: void };
  /** Copies a skill folder, or extracts a .zip/.skill archive, into the skills folder. */
  import_skill: { params: { path: string }; result: SkillSummary[] };

  list_mcp_servers: { params: NoParams; result: McpOverview };
  save_mcp_server: {
    params: { originalName?: string; server: McpServerSettings };
    result: void;
  };
  delete_mcp_server: { params: { name: string }; result: void };
  reconnect_mcp_server: { params: { name: string }; result: void };
  mcp_sign_in: { params: { name: string }; result: void };
  mcp_sign_out: { params: { name: string }; result: void };
  /** Raw mcp.json, for pasting a config from Claude Desktop, Cursor, and similar clients. */
  get_mcp_json: { params: NoParams; result: string };
  save_mcp_json: { params: { text: string }; result: void };

  /** Default agent first, then by name. */
  list_agents: { params: NoParams; result: AgentProfile[] };
  list_agent_tool_options: { params: NoParams; result: AgentToolOption[] };
  save_agent: { params: { agent: SaveAgentInput }; result: AgentProfile };
  /** The default agent cannot be deleted. Conversations using it fall back to the default. */
  delete_agent: { params: { id: string }; result: void };
  /** Agent for the open conversation (saved with it) and for new conversations. */
  set_agent: { params: { id: string }; result: void };
  /** Thinking level for the open conversation (saved with it) and for new conversations. */
  set_thinking_level: { params: { level: ThinkingLevel }; result: void };
  /** JSON text of an `AgentExportFile`. */
  export_agent: { params: { id: string }; result: string };
  /** Creates an agent from `AgentExportFile` JSON; a taken name gets a " (2)" suffix. */
  import_agent: { params: { json: string }; result: AgentProfile };

  /** Default workspace first, then by name. */
  list_workspaces: { params: NoParams; result: WorkspaceProfile[] };
  save_workspace: { params: { workspace: SaveWorkspaceInput }; result: WorkspaceProfile };
  /** The default workspace cannot be deleted. Its conversations move to the default workspace. */
  delete_workspace: { params: { id: string }; result: void };

  /** Saved notes of every place, newest first, and whether memory is on. */
  get_memory: { params: NoParams; result: MemoryView };
  /** The global switch of long-term memory (Settings › Memory). */
  set_memory_enabled: { params: { enabled: boolean }; result: MemoryView };
  /**
   * Adds a note (`id` omitted) or edits one. A note that already exists in its place is not added
   * twice. `workspaceId`: null/omitted = every workspace, else one workspace; an edit can move the
   * note, an omitted `workspaceId` keeps where it lives.
   */
  save_memory_entry: {
    params: { id?: string; text: string; tag?: string | null; workspaceId?: string | null };
    result: MemoryEntry;
  };
  delete_memory_entry: { params: { id: string }; result: void };
  /** Forgets every note. */
  clear_memory: { params: NoParams; result: void };

  /** Scheduled tasks with their running state and next run, by name. */
  list_scheduled_tasks: { params: NoParams; result: ScheduledTaskView[] };
  /** Adds a task (`id` omitted) or edits one. */
  save_scheduled_task: { params: { task: SaveScheduledTaskInput }; result: ScheduledTaskView };
  delete_scheduled_task: { params: { id: string }; result: void };
  set_scheduled_task_enabled: { params: { id: string; enabled: boolean }; result: void };
  /** Queues a run now (also for a disabled task). Fails when the task is already queued or running. */
  run_scheduled_task: { params: { id: string }; result: void };

  /** Voice input setting, and whether it can transcribe right now. */
  get_voice: { params: NoParams; result: VoiceView };
  save_voice: { params: { config: VoiceSettings }; result: VoiceView };
  /** Downloads a local whisper.cpp model into the app's models folder. */
  install_voice_model: { params: { model: VoiceModelPreset }; result: VoiceView };
  /** Sends a recording to the transcription service chosen in Settings; the key stays here. */
  transcribe_audio: {
    params: { data: string; mimeType: string; durationMs: number };
    result: { text: string };
  };

  get_service_status: { params: NoParams; result: ServiceStatus };
  /** Registers (or removes) the daemon with the OS service manager. */
  set_service_installed: { params: { installed: boolean }; result: ServiceStatus };
  get_telegram_status: { params: NoParams; result: TelegramStatus };
  save_telegram: { params: { config: SaveTelegramInput }; result: TelegramStatus };
  /** Opens a pairing window and returns the status with the one-time code. */
  start_telegram_pairing: { params: NoParams; result: TelegramStatus };
  /** Removes the token and the paired owner and turns the channel off. */
  forget_telegram: { params: NoParams; result: TelegramStatus };
}

export type AgentCommandType = keyof AgentCommandMap;
export type AgentCommand = {
  [K in AgentCommandType]: { type: K } & AgentCommandMap[K]["params"];
}[AgentCommandType];
export type AgentCommandResult<K extends AgentCommandType> = AgentCommandMap[K]["result"];

/**
 * Where the app stands with updates. `in-app` updates download and install from inside the app
 * (Windows, Linux AppImage); `download-page` ones open the release page (macOS builds are not
 * Developer ID signed, so macOS cannot replace itself, and `.deb` installs belong to the system).
 */
export type UpdateState = { currentVersion: string } &
  /** Development runs and unpackaged builds never check. */
  (
    | { status: "disabled" }
    /** Nothing checked yet in this session. */
    | { status: "idle" }
    | { status: "checking" }
    | { status: "up-to-date" }
    | {
        status: "available";
        version: string;
        install: "in-app" | "download-page";
        releaseUrl: string;
      }
    | { status: "downloading"; version: string; percent: number }
    | { status: "ready"; version: string }
    | { status: "error"; message: string }
  );

/** API exposed on `window.ppAgent` by the preload script. */
export interface DesktopBridge {
  agent: {
    command<C extends AgentCommand>(command: C): Promise<AgentCommandResult<C["type"]>>;
    onEvent(listener: (event: AgentEvent) => void): () => void;
  };
  files: {
    /** Opens the system file picker. */
    pick(): Promise<Attachment[]>;
    /** Picks a skill folder or a .zip/.skill archive; null when cancelled. */
    pickSkill(): Promise<string | null>;
    /** Path of a dropped `File`, or "" when it has none (for example, pasted data). */
    pathFor(file: File): string;
    /** Opens a workspace folder (the open conversation's, from the snapshot) in Finder / Explorer. */
    openWorkspace(dir: string): Promise<void>;
    /** Shows a file or folder (a skill, mcp.json) in Finder / Explorer. */
    reveal(path: string): Promise<void>;
    /** Picks a folder (a new workspace's folder); null when cancelled. */
    pickFolder(): Promise<string | null>;
    /** Picks an exported agent file and returns its text; null when cancelled. */
    openAgentFile(): Promise<string | null>;
    /** Asks where to save an exported agent; false when cancelled. */
    saveAgentFile(suggestedName: string, json: string): Promise<boolean>;
    /** Asks where to save an exported conversation; false when cancelled. */
    saveExport(suggestedName: string, format: ExportFormat, content: string): Promise<boolean>;
  };
  updates: {
    state(): Promise<UpdateState>;
    /** Looks for a newer release; the result arrives as a state change. */
    check(): Promise<void>;
    /** Downloads the update in the app, or opens its release page when it cannot install itself. */
    download(): Promise<void>;
    /** Quits and installs a downloaded update. */
    install(): Promise<void>;
    onState(listener: (state: UpdateState) => void): () => void;
  };
  /** Opens an http(s) URL in the default browser. */
  openExternal(url: string): Promise<void>;
  shell: {
    /** The global shortcut fired: the window is in front, focus the message box. */
    onFocusComposer(listener: () => void): () => void;
    /** True once when the window was created by the shortcut and missed the event; clears it. */
    takePendingFocus(): Promise<boolean>;
  };
}

export const IPC = {
  agentCommand: "agent:command",
  agentEvent: "agent:event",
  filesPick: "files:pick",
  filesPickSkill: "files:pick-skill",
  filesOpenWorkspace: "files:open-workspace",
  filesReveal: "files:reveal",
  filesPickFolder: "files:pick-folder",
  filesOpenAgent: "files:open-agent",
  filesSaveAgent: "files:save-agent",
  filesSaveExport: "files:save-export",
  openExternal: "shell:open-external",
  updatesState: "updates:state",
  updatesCheck: "updates:check",
  updatesDownload: "updates:download",
  updatesInstall: "updates:install",
  updatesEvent: "updates:event",
  shellFocusComposer: "shell:focus-composer",
  shellTakePendingFocus: "shell:take-pending-focus",
} as const;

// ---------------------------------------------------------------------------------------------
// Client ↔ daemon (pp-agentd)
// ---------------------------------------------------------------------------------------------

/** Bump when a frame below changes incompatibly; a client talking to another version shuts the daemon down. */
export const DAEMON_PROTOCOL = 2;

export interface AgentPaths {
  /** Folder of the built-in workspace; other workspaces use their own folder. */
  workspaceDir: string;
  agentDir: string;
  sessionDir: string;
  /** App settings file (SettingsFile: settings, gateways, agents), owned by the daemon. */
  settingsFile: string;
  /** Folder with files shipped with the app (OfficeCLI, built-in skills); overrides the lookup next to the bundle. */
  resourcesDir?: string;
}

/** Stored credential for one provider, same shape as pi's auth.json entries. */
export type StoredCredential =
  | { type: "api_key"; key?: string; env?: Record<string, string> }
  | { type: "oauth"; refresh: string; access: string; expires: number; [key: string]: unknown };

/**
 * Frames are newline-delimited JSON over the daemon's local socket (a Unix socket, or a named pipe
 * on Windows). The first frame a client sends is `hello`.
 */
export type ClientFrame =
  | {
      kind: "hello";
      protocol: number;
      /** Fresh client nonce and HMAC of the server challenge and hello fields; never the token. */
      nonce: string;
      proof: string;
      appVersion: string;
    }
  | { kind: "command"; id: number; command: AgentCommand }
  /** One-time import of credentials the old desktop vault held; answered with a `result`. */
  | { kind: "vault_import"; id: number; entries: Record<string, StoredCredential> }
  /** Asks the daemon to exit (an update replaced it, or the desktop app started it and is quitting). */
  | { kind: "shutdown" };

export type DaemonFrame =
  | { kind: "challenge"; nonce: string }
  | { kind: "hello_ok"; protocol: number; appVersion: string; pid: number; proof: string }
  | { kind: "hello_error"; error: string }
  | { kind: "event"; event: AgentEvent }
  | { kind: "result"; id: number; ok: true; data: unknown }
  | { kind: "result"; id: number; ok: false; error: string }
  | { kind: "open_url"; url: string };

/** Workspace folder (relative) that attached files are copied into. */
export const ATTACHMENTS_DIR = "attachments";
