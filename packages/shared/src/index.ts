/**
 * Contract shared by the Electron main process, the agent utility process, and the renderer.
 * Everything crossing a process boundary is defined here so the three sides cannot drift.
 */

export * from "./accelerator.ts";
export * from "./cron.ts";
export * from "./server-address.ts";

/** Approval tier of a tool, modelled on omp: reads run freely, writes and execution need a person. */
export type ToolTier = "read" | "write" | "exec";

export type ToolStatus =
  | "running"
  | "awaiting-approval"
  /** `ask_user` is waiting for the person to answer. */
  | "awaiting-answer"
  | "done"
  | "error"
  | "denied";

/** Tool that hands focused research tasks to sub agents. */
export const DELEGATE_TASK_TOOL = "delegate_task";

/** One sub agent of `delegate_task`, as it works, for the chat to show its status. */
export interface HelperProgress {
  /** Label the person sees; unique within the call. */
  label: string;
  status: "working" | "done" | "failed";
  /** Tool calls it made, oldest first: the tool's name and what it works on. */
  steps: { tool: string; target: string }[];
  /** Why it failed; only with status `failed`. */
  error?: string;
}

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
      /** Progress of the sub agents of `delegate_task`, while it runs. */
      helpers?: HelperProgress[];
    };

export interface ChatMessage {
  id: string;
  /** `compaction` marks where older messages were summarized for the model; it has no parts. */
  role: "user" | "assistant" | "compaction";
  parts: ChatPart[];
  error?: string;
  /**
   * What the model's provider actually said (with its name and the model), when the turn failed.
   * `error` is the one readable sentence; this is for the person to copy to whoever debugs it.
   */
  errorDetail?: string;
  /**
   * Id of the message's entry in the saved conversation, which message actions (edit, regenerate,
   * branch) refer to. Absent while the message is still streaming.
   */
  entryId?: string;
  /** When the message was sent (a person's) or the model started answering (a reply), in ms. */
  at?: number;
  /** When a reply finished, in ms; absent while it streams. */
  endedAt?: number;
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
  /**
   * `computer` only: the app the agent asks to use for the first time in this conversation. The
   * person may allow it for this call, for the conversation, or always (`respond_approval.remember`).
   */
  app?: ComputerApp;
}

/** One choice of a question the agent asks (`ask_user`). */
export interface QuestionOption {
  label: string;
  description?: string;
}

/** One question the agent asks. The person may also type an answer of their own ("Other"). */
export interface Question {
  /** Names the answer in the result the model reads; unique within one call. */
  id: string;
  question: string;
  options: QuestionOption[];
  /** More than one option may be picked. */
  multi?: boolean;
  /** Position (from 0) of the option the agent suggests. */
  recommended?: number;
}

/** Questions waiting for the person's answer. */
export interface QuestionRequest {
  requestId: string;
  /** Tool call in the transcript that the card belongs to. */
  toolCallId: string;
  questions: Question[];
  /**
   * Markdown the card shows above the questions: the research plan the person is asked to
   * confirm. Absent for ordinary questions.
   */
  plan?: string;
}

/** What the person answered to one question. `custom` is the text typed for "Other". */
export interface QuestionAnswer {
  id: string;
  selected: string[];
  custom?: string;
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

/** A goal the agent keeps working on across turns until it reports it done. */
export interface GoalSummary {
  objective: string;
  /** `active` continues by itself after each turn; `paused` waits for the person to resume it. */
  status: "active" | "paused";
  /** The agent made no move on its last turn and waits for the person to write or resume. */
  waiting: boolean;
}

/** How much effort a research run puts in: rounds of helpers, critique, number of sources. */
export const RESEARCH_DEPTHS = ["quick", "standard", "deep"] as const;
export type ResearchDepth = (typeof RESEARCH_DEPTHS)[number];

/** Longest question a research run takes. */
export const MAX_RESEARCH_QUESTION_LENGTH = 4000;

/** A source the research report cites, as the agent recorded it with `research_sources`. */
export interface ResearchSource {
  /** The number the report cites it by: [n]. */
  n: number;
  title: string;
  url: string;
  publisher?: string;
  /** Date of the information, as written (for example "2025-06" or "2025-06-30"). */
  date?: string;
  type?: "primary" | "press" | "analyst" | "academic" | "community" | "vendor" | "other";
}

/** Where a research run is: `plan` waits for the person to start it. */
export type ResearchPhase = "planning" | "plan" | "researching" | "writing" | "done";

/** A research run of a conversation: a question the agent researches in rounds and reports on. */
export interface ResearchSummary {
  question: string;
  depth: ResearchDepth;
  /** `active` continues by itself after each turn; `paused` waits for the person; `done` has its report. */
  status: "active" | "paused" | "done";
  phase: ResearchPhase;
  /** The agent made no move on its last turn (or asked something) and waits for the person. */
  waiting: boolean;
  /** Distinct web pages the agent and its helpers have opened so far. */
  visited: number;
  /** Sources recorded so far; the final report cites these. */
  sources: ResearchSource[];
  /** Saved report files, relative to the workspace folder; null until the first draft is saved. */
  report: { markdown: string; html: string | null } | null;
}

/** The text of a saved report, for a client that cannot read the workspace (the phone). */
export interface ResearchReport {
  markdown: string;
  html: string | null;
  /** Paths relative to the workspace folder. */
  markdownPath: string;
  htmlPath: string | null;
}

export interface AgentSnapshot {
  status: AgentStatus;
  /**
   * The open conversation's messages. Empty when `messagesUnchanged` is set.
   */
  messages: ChatMessage[];
  /**
   * Set on a snapshot sent because a setting of the open conversation changed (its model, thinking
   * level, yolo mode or goal): the messages did not, so they are left out, and a listener that has
   * this conversation keeps its own. A listener that does not asks for a full snapshot.
   */
  messagesUnchanged?: boolean;
  approvals: ApprovalRequest[];
  /** Questions of `ask_user` that wait for an answer. */
  questions: QuestionRequest[];
  /** Model of the open conversation. */
  model: ModelSummary | null;
  /** Agent of the open conversation. */
  agent: AgentSummary | null;
  /** Thinking (reasoning effort) of the open conversation; `available` is empty when its model can't think. */
  thinking: { level: ThinkingLevel; available: ThinkingLevel[] };
  /**
   * Yolo mode for this conversation: `active` is whether every tool runs without asking right
   * now; `source` is `"settings"` while it is forced on in Settings › Tools (the conversation
   * switch does nothing there), or `"conversation"` while this conversation's own switch decides.
   */
  yolo: { active: boolean; source: "settings" | "conversation" };
  /** Goal the open conversation is working toward, if any. */
  goal: GoalSummary | null;
  /** Research run of the open conversation, if any (also after it finished, until cleared). */
  research: ResearchSummary | null;
  /** Workspace of the open conversation. */
  workspace: WorkspaceSummary | null;
  /** Folder the open conversation works in (its workspace's folder). */
  workspaceDir: string | null;
  /** Session file of the open conversation. */
  sessionPath: string | null;
  /** The open conversation is temporary: it has no session file and is dropped when left. */
  temporary: boolean;
  /** Context window usage of the open conversation; null while it has no model. */
  context: ContextUsage | null;
  /** Which conversations are answering right now, the open one and those left running. */
  activity: SessionActivity;
}

/** Session files of the conversations that are answering, and of those waiting for the person. */
export interface SessionActivity {
  running: string[];
  /** Waiting on an approval or an answer; a subset of `running`. */
  waiting: string[];
}

/** Which settings area changed; the renderer refetches the matching query (`[scope]`). */
export type SettingsScope =
  | "settings"
  | "providers"
  | "models"
  | "tools"
  | "skills"
  | "mcp"
  /** Mailboxes the agent may read and send from (Connectors › Email). */
  | "email"
  | "agents"
  | "workspaces"
  | "sessions"
  | "memory"
  | "scheduledTasks"
  | "voice"
  | "background"
  | "browserProfiles"
  | "computerApps"
  /** Phone and LAN access: on/off, address, pairing, paired devices. */
  | "remoteAccess";

export type AgentEvent =
  | { type: "status"; status: AgentStatus }
  /** Insert or replace the message with this id. */
  | { type: "message"; message: ChatMessage }
  /**
   * More text of the text or thinking part `index` of the message `id`, while a reply streams: only
   * what was added, so a long answer is not sent whole at every update. `text` starts at character
   * `offset` of the part; a listener that already has some of it (from a snapshot) keeps its own.
   * The message's final update is always a full `message`.
   */
  | { type: "message_append"; id: string; index: number; offset: number; text: string }
  | { type: "snapshot"; snapshot: AgentSnapshot }
  | { type: "approval_requested"; request: ApprovalRequest }
  | { type: "approval_resolved"; requestId: string }
  | { type: "question_requested"; request: QuestionRequest }
  /** The questions were answered, skipped, or made obsolete (the run stopped). */
  | { type: "question_resolved"; requestId: string }
  /** The open conversation's research run changed (a phase, a source, a page opened); null when cleared. */
  | { type: "research"; research: ResearchSummary | null }
  /** The saved conversation list changed (new, renamed, deleted, or a turn finished). */
  | { type: "sessions_changed" }
  /** The open conversation's context usage changed (a reply finished, or it was compacted). */
  | { type: "context"; context: ContextUsage | null }
  /** A conversation started or stopped answering, or began or stopped waiting for the person. */
  | { type: "activity"; activity: SessionActivity }
  | { type: "settings_changed"; scopes: SettingsScope[] }
  /** A sign-in flow (provider or MCP server) needs input from the person. */
  | { type: "auth_prompt"; prompt: AuthPrompt }
  /** The prompt was answered, cancelled, or made obsolete by the flow itself. */
  | { type: "auth_prompt_closed"; promptId: string }
  /** Progress or instructions from a sign-in flow (for example a URL that was opened). */
  | { type: "auth_info"; flowTitle: string; message: string; url?: string }
  /** The background memory pass changed notes; `undo_memory_pass` with `passId` reverses it. */
  | { type: "memory_auto_saved"; passId: string; changes: MemoryChange[] }
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
  /** Supports extended thinking. Default: the model's value in Pi's catalog, else false. */
  reasoning?: boolean;
  /** Accepts image input. Default: the model's value in Pi's catalog, else true. */
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

/** A model a gateway listed, with the name, limits, and capabilities the gateway (or Pi's catalog) reports. */
export type FetchedGatewayModel = Pick<
  GatewayModel,
  "id" | "name" | "contextWindow" | "maxTokens" | "reasoning" | "images"
>;

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
   * Model for small background calls (conversation titles, memory). Null = the cheapest model of
   * the conversation's provider.
   */
  fastModel: ModelRef | null;
  /**
   * Lets the agent run shell commands (bash, or PowerShell on Windows). Each command asks unless
   * the shell's own policy is `allow`.
   */
  shellEnabled: boolean;
  /**
   * Every tool runs without asking, as if each had policy `allow` (shell included, bypassing its
   * own ask default). Locked and off tools are unaffected.
   */
  yoloMode: boolean;
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
  /** Characters of notes in the system prompt's profile; pinned and personal notes come first. */
  maxInjectedLength: 2000,
} as const;

/** A short fact or preference the agent keeps across conversations. */
export interface MemoryEntry {
  id: string;
  text: string;
  /** One short label ("preference", "project"…); null = none. */
  tag: string | null;
  /** Where the note lives: null = every workspace, else only that workspace's conversations. */
  workspaceId: string | null;
  /** Always in the prompt's profile; the background memory pass never changes it. */
  pinned: boolean;
}

/** One change the background memory pass made: `before` null = added, `after` null = deleted. */
export interface MemoryChange {
  before: MemoryEntry | null;
  after: MemoryEntry | null;
}

export interface MemoryView {
  /** Global switch: off = no notes in prompts and the memory tools do nothing. */
  enabled: boolean;
  /** Each place's notes, newest first (the order of the lines in its MEMORY.md, last = newest). */
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
// Configuration bundles (bulk setup: one file an admin hands out to many people)
// ---------------------------------------------------------------------------------------------

/**
 * A configuration bundle file: the app setup an admin hands out to many people, or drops into the
 * app folder (`settings.import.json`) for unattended setup. Secrets (gateway keys, channel tokens)
 * are never in it; each machine keeps its own in the vault, under the ids the bundle references.
 */
export interface ConfigBundleFile {
  ppAgentConfig: 1;
  config: ConfigBundle;
}

/** The settings a bundle carries. Fields it leaves out stay as they are where it is applied. */
export interface ConfigBundle {
  /** Gateway definitions (models); each one's API key is a vault entry under `gateway.id`. */
  gateways?: GatewayConfig[];
  /** Models chosen by default; null clears the choice. */
  defaultModel?: ModelRef | null;
  fastModel?: ModelRef | null;
  thinkingLevel?: ThinkingLevel;
  /** Agents merged by name (names are unique, case-insensitive); ids are machine-specific. */
  agents?: Omit<AgentProfile, "id">[];
  /** MCP servers in the `mcpServers` shape of mcp.json, merged by name. */
  mcpServers?: Record<string, unknown>;
  /** Tool name → policy, merged per tool. */
  toolPolicies?: Record<string, ToolPolicy>;
  shellEnabled?: boolean;
  yoloMode?: boolean;
  language?: LanguageSetting;
  /** Skills the agent must not see; the full list when the bundle carries it. */
  disabledSkills?: string[];
  /** Trusted skill folders (absolute paths); the full list when the bundle carries it. */
  trustedSkillFolders?: string[];
}

/** How much an applied bundle changed, per area; areas it left out count 0. */
export interface ConfigImportReport {
  gateways: number;
  agents: number;
  mcpServers: number;
  toolPolicies: number;
  /** General fields: the two models, thinking level, shell, yolo, language. */
  settings: number;
  disabledSkills: number;
  trustedSkillFolders: number;
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
  /** Agent for new conversations here; null = the agent picked last. */
  agentId: string | null;
}

/** The rules file of a workspace: `AGENTS.md` in its folder. */
export interface WorkspaceInstructions {
  /** The folder's AGENTS.md (it may not exist yet). */
  path: string;
  content: string;
  exists: boolean;
  /** AGENTS.override.md sits next to it, and Pi reads that one instead. */
  overridden: boolean;
  /** Other context files (parent folders, the app's own) loaded into the conversation as well. */
  inherited: string[];
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
export type ToolWarning = "shell-unrestricted" | "yolo-mode";

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
  /** Global switch of long-term memory (Settings › Memory). */
  memoryEnabled: boolean;
  /** Always contains the profile with id `DEFAULT_BROWSER_PROFILE_ID`. */
  browserProfiles: BrowserProfile[];
  /** Apps the agent's `computer` tool may always use, or never. */
  computerApps: ComputerAppAccess;
  /** Workspace folders (absolute) whose `.agents/skills` the person trusted; others' skills do not load. */
  trustedSkillFolders: string[];
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

/** Per-chat settings for a Telegram chat. */
export interface TelegramChatSettings {
  /** Human label for the settings UI. */
  label?: string;
  /** Agent for this chat; falls back to the channel's agent. */
  agentId?: string;
  /** Workspace for this chat; falls back to the channel's workspace. */
  workspaceId?: string;
  /** Who can talk to the bot: `owner` (default) or `members` (anyone in the chat). */
  access?: "owner" | "members";
  /** User ids allowed when `access` is `members`; empty = everyone in the chat. */
  allowedUsers?: number[];
  /** What happens when a message arrives while the agent is busy. */
  busyMode?: "queue" | "steer" | "interrupt";
}

/** One Telegram bot in settings.json. The bot token is in the vault, never here. */
export interface TelegramSettings {
  enabled: boolean;
  /** Workspace of new Telegram conversations; the agent is the workspace's own unless pinned here. */
  workspaceId: string;
  /** Agent pinned for Telegram; null = the workspace's agent, else the built-in agent. */
  agentId: string | null;
  /** Telegram user id that paired with the bot; only this person is answered. */
  ownerId: number | null;
  ownerName: string | null;
  /** Per-chat settings keyed by chat id (as string). */
  chats?: Record<string, TelegramChatSettings>;
}

/** Per-chat settings for a Zalo chat. */
export interface ZaloChatSettings {
  /** Human label for the settings UI. */
  label?: string;
  /** Agent for this chat; falls back to the channel's agent. */
  agentId?: string;
  /** Workspace for this chat; falls back to the channel's workspace. */
  workspaceId?: string;
  /** Who can talk to the bot: `owner` (default) or `members` (anyone in the chat). */
  access?: "owner" | "members";
  /** User ids allowed when `access` is `members`; empty = everyone in the chat. */
  allowedUsers?: string[];
  /** What happens when a message arrives while the agent is busy. */
  busyMode?: "queue" | "steer" | "interrupt";
}

/** One Zalo bot in settings.json. The bot token is in the vault, never here. */
export interface ZaloSettings {
  enabled: boolean;
  /** Workspace of new Zalo conversations; the agent is the workspace's own unless pinned here. */
  workspaceId: string;
  /** Agent pinned for Zalo; null = the workspace's agent, else the built-in agent. */
  agentId: string | null;
  /** Zalo user id that paired with the bot; only this person is answered. */
  ownerId: string | null;
  ownerName: string | null;
  /** Per-chat settings keyed by chat id (as string); covers group chats. */
  chats?: Record<string, ZaloChatSettings>;
}

/**
 * Id of the first account of a chat app. Its chat keys keep the short form (`telegram:123`) and
 * its token the short vault id (`channel:telegram`), so what was saved before accounts still works.
 */
export const DEFAULT_CHANNEL_ACCOUNT_ID = "default";

/**
 * What a chat key of this account starts with, before the chat id: `telegram` for the first
 * account (so keys saved before accounts existed still match) and `telegram:<account>` for the
 * others. Chat ids never contain `:`, so the key's last colon always splits the two.
 */
export function chatKeyPrefix(kind: "telegram" | "zalo", accountId: string): string {
  return accountId === DEFAULT_CHANNEL_ACCOUNT_ID ? kind : `${kind}:${accountId}`;
}

/** Ids of accounts: short, lower case, and never containing the `:` of a chat key. */
export const CHANNEL_ACCOUNT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** A chat app can have as many accounts (bots) as the person wants, each with its own token. */
export interface ChannelAccount {
  /** Stable id; part of the chat keys and the vault id of every account but the first. */
  id: string;
  /** Name the person gave it ("Work bot"); empty when none. */
  label: string;
}

export interface TelegramAccountSettings extends TelegramSettings, ChannelAccount {}
export interface ZaloAccountSettings extends ZaloSettings, ChannelAccount {}

/** The first account comes first; its owner is where `home` deliveries go. */
export interface ChannelsSettings {
  telegram: TelegramAccountSettings[];
  zalo: ZaloAccountSettings[];
}

export type ChannelState = "off" | "connecting" | "online" | "error";

export interface TelegramStatus extends TelegramAccountSettings {
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
  /** The account to change; omitted adds a new account (which needs a token). */
  accountId?: string;
  /** Name of the account; omitted keeps it (empty for a new one). */
  label?: string;
  /** A new bot token; omitted keeps the stored one. */
  token?: string;
  enabled: boolean;
  /** null = follow the workspace's agent. */
  agentId: string | null;
  workspaceId: string;
  /** Per-chat settings; omitted keeps the stored ones. */
  chats?: Record<string, TelegramChatSettings>;
}

export interface ZaloStatus extends ZaloAccountSettings {
  hasToken: boolean;
  /** The bot's account name; known once Zalo has accepted the token. */
  botName: string | null;
  state: ChannelState;
  error: string | null;
  /** One-time code to send to the bot as `/pair <code>`, while a pairing is open. */
  pairingCode: string | null;
  pairingExpiresAt: number | null;
}

export interface SaveZaloInput {
  /** The account to change; omitted adds a new account (which needs a token). */
  accountId?: string;
  /** Name of the account; omitted keeps it (empty for a new one). */
  label?: string;
  /** A new bot token; omitted keeps the stored one. */
  token?: string;
  enabled: boolean;
  /** null = follow the workspace's agent. */
  agentId: string | null;
  workspaceId: string;
  /** Per-chat settings; omitted keeps the stored ones. */
  chats?: Record<string, ZaloChatSettings>;
}

// ---------------------------------------------------------------------------------------------
// Phone and LAN access (the web app served by the daemon)
// ---------------------------------------------------------------------------------------------

/** Port the daemon serves the web app on when nothing else is chosen. */
export const REMOTE_DEFAULT_PORT = 47830;

/** A phone or another computer that paired with the web app. Its secret never leaves the daemon. */
export interface RemoteDevice {
  id: string;
  /** What the device called itself when it paired (a browser and system, e.g. "Safari on iPhone"). */
  name: string;
  /** Epoch milliseconds. */
  pairedAt: number;
  /** Last request it made, epoch milliseconds. */
  lastSeenAt: number;
  /** Whether it is receiving live updates right now. */
  connected: boolean;
}

export type RemoteAccessState = "off" | "listening" | "error";

/** Settings › Remote access: whether the web app is served on the local network, and to whom. */
export interface RemoteAccessStatus {
  enabled: boolean;
  port: number;
  state: RemoteAccessState;
  /** Why it is not listening (port taken, web app not built), for the person to read. */
  error: string | null;
  /** `http://<address>:<port>` for every local network address of this computer. */
  urls: string[];
  /** One-time code a device enters to pair, while a pairing is open. */
  pairingCode: string | null;
  pairingExpiresAt: number | null;
  devices: RemoteDevice[];
}

/**
 * Commands only the computer itself may send; the web app is refused them. Besides remote access
 * itself, these are the settings that let the computer run programs without anyone approving each
 * one (MCP servers start commands, tool policies can skip approvals), a path on the computer that
 * only its own file picker can supply, the Telegram and Zalo set-up (whoever pairs there talks to
 * the agent from anywhere, and keeps doing so after the device is forgotten), and bulk deletions
 * and the login service, which a copied device token must not be able to do.
 */
export const REMOTE_LOCAL_ONLY_COMMANDS = [
  "get_remote_access",
  "set_remote_access",
  "start_remote_pairing",
  "forget_remote_device",
  "save_mcp_server",
  "save_mcp_json",
  // Email passwords live on the computer; a phone may start a conversation, not change one.
  "save_email_account",
  "delete_email_account",
  "test_email_account",
  "set_tool_policy",
  // mcp.json holds the servers' keys and tokens in plain text.
  "get_mcp_json",
  "import_skill",
  // A bundle carries mcp.json's plain-text keys and can turn the shell and yolo mode on.
  "export_config",
  "import_config",
  "save_telegram",
  "start_telegram_pairing",
  "forget_telegram",
  "save_zalo",
  "start_zalo_pairing",
  "forget_zalo",
  "delete_workspace",
  "clear_sessions",
  "clear_memory",
  "set_service_installed",
] as const satisfies readonly AgentCommandType[];

/**
 * Whether the web app may send `command`. Turning the shell, yolo mode or an always-allowed app
 * off is fine from a phone; turning them on is not. A device may also not create a workspace
 * (its folder is created anywhere, and the AGENTS.md written there is read by every agent working
 * below it); editing an existing one keeps its folder. Unblocking an app depends on the current
 * lists, so the remote access server checks that itself.
 */
export function remoteMayRun(command: AgentCommand): boolean {
  if ((REMOTE_LOCAL_ONLY_COMMANDS as readonly string[]).includes(command.type)) return false;
  if (command.type === "set_conversation_yolo") return command.active !== true;
  // "Always allowed" lets the agent use an app on the computer without asking.
  if (command.type === "set_computer_app_access") return command.access !== "allowed";
  if (command.type === "respond_approval") return command.remember !== "always";
  if (command.type === "save_workspace") return typeof command.workspace?.id === "string";
  // Trusting a workspace loads the skills in its folder, written by whoever made the folder.
  if (command.type === "set_workspace_skills_trust") return command.trusted !== true;
  if (command.type === "update_settings") {
    const patch: SettingsPatch = command.patch ?? {};
    return patch.shellEnabled !== true && patch.yoloMode !== true;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Scheduled tasks (prompts that run on a schedule, without opening a chat)
// ---------------------------------------------------------------------------------------------

/** Limits shared so the editor enforces the same ones as the agent. */
export const SCHEDULE_LIMITS = {
  maxTasks: 50,
  maxNameLength: 60,
  maxPromptLength: 20_000,
  /** The shortest gap a cron expression may leave between two runs. */
  minMinutes: 5,
} as const;

/** Times are local to the computer. Weekdays are numbered like `Date.getDay()`: 0 = Sunday. */
export type TaskSchedule =
  | { kind: "once"; at: number }
  /** Five-field cron expression (`minute hour day-of-month month day-of-week`), see `parseCron`. */
  | { kind: "cron"; expr: string };

/**
 * Where a scheduled run executes: `current` reads the tail of the session that created it and
 * commits its result there; `new` opens a fresh conversation every run; `session` reuses one
 * named session across runs.
 */
export type ScheduleTarget =
  | { mode: "current"; sessionId: string }
  | { mode: "new" }
  | { mode: "session"; sessionId: string };

/**
 * Where a run's result goes: `session` writes it into the run's own session (default), `peer`
 * writes it into a chat session and pushes it through the channel, `none` keeps it local only.
 */
export type ScheduleDelivery = { to: "session" } | { to: "peer"; peer: string } | { to: "none" };

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
  /** How delivery went: `sent`, `session`, `none`, or `failed` with a reason. */
  delivery?: "sent" | "session" | "none" | string;
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
  /** Where each run executes; default `{ mode: "new" }`. */
  target?: ScheduleTarget;
  /** Where the result is delivered; default `{ to: "session" }`. */
  delivery?: ScheduleDelivery;
  /** Session id where the task was created (for `target: current`). */
  origin?: string;
  /** Remove the task after it fires (for `once`). */
  deleteAfterRun?: boolean;
  /** Deliver nothing when the run produces `[SILENT]`. */
  silentIfEmpty?: boolean;
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
export const SEARCH_PROVIDERS = [
  "searxng",
  "serper",
  "tavily",
  "brave",
  "exa",
  "webclaw",
  "duckduckgo",
] as const;
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
  /**
   * Provider → new key; `null` removes the stored key; a provider left out keeps its key, unless
   * its endpoint changed (a stored key never goes to another address than the one it was saved for).
   */
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

/** The OAuth client an HTTP server signs in with, when it does not register clients itself (Google). */
export interface McpOAuthClient {
  /** Absent when the client identifies itself with a metadata document (`clientRegistration: "cimd"`). */
  clientId?: string;
  clientSecret?: string;
  /** Scopes to ask for, separated by spaces. */
  scope?: string;
  /**
   * Where the browser returns after sign-in: an `http://127.0.0.1:<port>/callback` address. Needed
   * when the client's redirect URIs are registered one by one (a Google “Web application” client).
   */
  callbackUrl?: string;
  /**
   * How the client names itself to the authorization server: `dcr` registers one (the default
   * `auto`), `cimd` presents the app's Client ID Metadata Document instead — for servers whose
   * authorization server has no registration endpoint (Logto, and so PP Hub).
   */
  clientRegistration?: "auto" | "dcr" | "cimd";
}

/** One `mcpServers` entry of mcp.json, as edited in Settings. Unknown keys are preserved on save. */
export interface McpServerSettings {
  name: string;
  description?: string;
  enabled: boolean;
  exposure: McpExposure;
  /** Per-request timeout in seconds. */
  timeout?: number;
  /**
   * The person trusts this server's own labels: a tool it marks read-only runs without asking under
   * `auto`. Off by default, so every tool of the server asks.
   */
  trusted?: boolean;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  /** Written by Connectors, kept as it is on every other save. */
  oauth?: McpOAuthClient;
  /**
   * The Connectors preset this server was added from (`pp-hub`), written by Connectors and kept on
   * every other save. Needed for a preset whose address each company chooses for itself: the URL
   * alone does not say which service it is.
   */
  connector?: string;
  /** Which account of a service this server is signed in to (“Work”), for telling servers of one service apart. */
  account?: string;
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

// ---------------------------------------------------------------------------------------------
// Email (IMAP and SMTP)
// ---------------------------------------------------------------------------------------------

/** One mail server of an account. `secure` = TLS from the start (993/465), else STARTTLS (143/587). */
export interface EmailServerSettings {
  host: string;
  port: number;
  secure: boolean;
  /** Sign-in name; the account's address when empty. */
  user?: string;
}

/**
 * A mailbox the agent may read and send from, as edited in Settings. The password is not here: it
 * lives in the vault (`email:<name>`), never in `email.json`.
 */
export interface EmailAccountSettings {
  /** Letters, digits, `_` and `-`; the tool calls name it when the account is not the only one. */
  name: string;
  /** Shown in Settings and to the agent ("Work", "Personal"); the address when empty. */
  label?: string;
  address: string;
  displayName?: string;
  imap: EmailServerSettings;
  smtp: EmailServerSettings;
}

export interface EmailAccountView {
  settings: EmailAccountSettings;
  /** False when the password is missing or the vault cannot be read: the account cannot connect. */
  hasPassword: boolean;
  /** The sign-in failed the last time this app tried it, with the message the server gave. */
  error?: string;
}

/** A mail provider whose server names and ports are known, so the person only types a password. */
export interface EmailProviderPreset {
  id: string;
  name: string;
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean };
  /** Where the person creates an app password, when the provider requires one. */
  passwordHelpUrl?: string;
}

/**
 * Presets offered by the email form. Most providers refuse the account password over IMAP/SMTP
 * and require an app password (with two-step verification on); the form says so and links to it.
 */
export const EMAIL_PROVIDERS: readonly EmailProviderPreset[] = [
  {
    id: "zoho",
    name: "Zoho Mail",
    imap: { host: "imap.zoho.com", port: 993, secure: true },
    smtp: { host: "smtp.zoho.com", port: 465, secure: true },
    passwordHelpUrl: "https://accounts.zoho.com/home#security/app_password",
  },
  {
    id: "gmail",
    name: "Gmail",
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    smtp: { host: "smtp.gmail.com", port: 465, secure: true },
    passwordHelpUrl: "https://myaccount.google.com/apppasswords",
  },
  {
    id: "outlook",
    name: "Outlook / Microsoft 365",
    imap: { host: "outlook.office365.com", port: 993, secure: true },
    smtp: { host: "smtp-mail.outlook.com", port: 587, secure: false },
    passwordHelpUrl: "https://account.microsoft.com/security",
  },
  {
    id: "yahoo",
    name: "Yahoo Mail",
    imap: { host: "imap.mail.yahoo.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, secure: true },
    passwordHelpUrl: "https://login.yahoo.com/account/security",
  },
  {
    id: "icloud",
    name: "iCloud Mail",
    imap: { host: "imap.mail.me.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.me.com", port: 587, secure: false },
    passwordHelpUrl: "https://account.apple.com/account/manage",
  },
  {
    id: "custom",
    name: "Other (IMAP and SMTP)",
    imap: { host: "", port: 993, secure: true },
    smtp: { host: "", port: 465, secure: true },
  },
];

/** The settings a person can change with `update_settings`. */
export type SettingsPatch = Partial<
  Pick<
    AppSettings,
    | "defaultModel"
    | "fastModel"
    | "shellEnabled"
    | "yoloMode"
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
  /**
   * Without `workspaceId`: in the workspace of the open conversation. `temporary` starts a chat
   * that is kept in memory only: never saved to history, and gone when the person leaves it.
   */
  new_chat: { params: { workspaceId?: string; temporary?: boolean }; result: void };
  /** `remember` applies to a request with an `app`: keep that app allowed for the conversation or always. */
  respond_approval: {
    params: { requestId: string; approved: boolean; remember?: ComputerAppRemember };
    result: void;
  };
  /** `answers` null: the person chose not to answer. */
  respond_question: {
    params: { requestId: string; answers: QuestionAnswer[] | null };
    result: void;
  };
  list_sessions: { params: NoParams; result: SessionSummary[] };
  /** Summarizes earlier messages of the open conversation to free up the model's context. */
  compact: { params: NoParams; result: void };
  open_session: { params: { path: string }; result: void };
  rename_session: { params: { path: string; name: string }; result: void };
  delete_session: { params: { path: string }; result: void };
  /** Deletes every saved conversation of one workspace. */
  clear_sessions: { params: { workspaceId: string }; result: void };
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
  /** Skills in `.agents/skills` of the open conversation's workspace folder; read-only here. */
  list_workspace_skills: { params: NoParams; result: SkillSummary[] };
  /** Skills in `.agents/skills` of every workspace folder (one per name); for the agent editor's skill list. */
  list_workspace_skill_options: { params: NoParams; result: SkillSummary[] };
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

  /** Mailboxes the agent may read and send from; the passwords stay in the vault. */
  list_email_accounts: { params: NoParams; result: EmailAccountView[] };
  /** The password is stored in the vault under the server's name; omitted keeps the saved one. */
  save_email_account: {
    params: { originalName?: string; account: EmailAccountSettings; password?: string };
    result: void;
  };
  delete_email_account: { params: { name: string }; result: void };
  /** Signs in to IMAP and sends nothing; resolves with the server's message when it fails. */
  test_email_account: { params: { name: string }; result: { ok: boolean; error?: string } };

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
  /** Yolo mode for the open conversation only; lost when it closes, and ignored while Settings forces it on. */
  set_conversation_yolo: { params: { active: boolean }; result: void };
  /**
   * Goal of the open conversation: `start` sets the objective and begins working on it (the agent
   * keeps going turn after turn until it reports the goal done); `pause` stops it between turns,
   * `resume` continues a paused one, and `clear` drops it. Refused while the conversation is answering
   * (except `pause` and `clear`) or, for `start`, when it already has a goal.
   */
  set_goal: {
    params: { action: "start"; objective: string } | { action: "pause" | "resume" | "clear" };
    result: void;
  };
  /**
   * Research run of the open conversation: `start` begins researching the question at a depth (the
   * agent plans, asks the person to confirm the plan, then works in rounds until it has saved the
   * report); `pause`, `resume` and `clear` work as for a goal. Refused while the conversation is
   * answering (except `pause` and `clear`) or, for `start`, when it already has a research run
   * or a goal.
   */
  set_research: {
    params:
      | { action: "start"; question: string; depth: ResearchDepth }
      | { action: "pause" | "resume" | "clear" };
    result: void;
  };
  /** The saved report of the open conversation's research run; null before the first draft. */
  get_research_report: { params: NoParams; result: ResearchReport | null };
  /** JSON text of an `AgentExportFile`. */
  export_agent: { params: { id: string }; result: string };
  /** Creates an agent from `AgentExportFile` JSON; a taken name gets a " (2)" suffix. */
  import_agent: { params: { json: string }; result: AgentProfile };

  /** JSON text of a `ConfigBundleFile` of this computer's setup; secrets are not in it. */
  export_config: { params: NoParams; result: string };
  /** Merges a `ConfigBundleFile` JSON into settings.json and mcp.json; fields it leaves out stay. */
  import_config: { params: { json: string }; result: ConfigImportReport };

  /** Default workspace first, then by name. */
  list_workspaces: { params: NoParams; result: WorkspaceProfile[] };
  /**
   * One folder of a workspace, for a person reading the computer's files from the app on a phone.
   * `dir` is relative to the workspace folder, `/`-separated ("" for its top).
   */
  list_workspace_files: {
    params: { workspaceId?: string; dir: string };
    result: WorkspaceEntry[];
  };
  /** A file of a workspace as text or an image, confined to the workspace folder. */
  preview_workspace_file: { params: { workspaceId?: string; path: string }; result: FilePreview };
  save_workspace: { params: { workspace: SaveWorkspaceInput }; result: WorkspaceProfile };
  read_workspace_instructions: { params: { id: string }; result: WorkspaceInstructions };
  /** Writes the folder's AGENTS.md; the open conversation reloads it when it is in that folder. */
  save_workspace_instructions: { params: { id: string; content: string }; result: void };
  /** Whether the skills in the workspace folder's `.agents/skills` load (off until the person trusts them). */
  get_workspace_skills_trust: { params: { id: string }; result: boolean };
  /**
   * Trusts the workspace folder's skills or stops trusting them; open conversations reload. Even
   * trusted, a workspace skill never replaces an installed skill of the same name.
   */
  set_workspace_skills_trust: { params: { id: string; trusted: boolean }; result: boolean };
  /** The default workspace cannot be deleted. Its conversations move to the default workspace. */
  delete_workspace: { params: { id: string }; result: void };

  /** Saved notes of every place, newest first, and whether memory is on. */
  get_memory: { params: NoParams; result: MemoryView };
  /** The global switch of long-term memory (Settings › Memory). */
  set_memory_enabled: { params: { enabled: boolean }; result: MemoryView };
  /**
   * Adds a note (`id` omitted) or edits one. A note that already exists in its place is not added
   * twice. `workspaceId`: null/omitted = every workspace, else one workspace; an edit can move the
   * note, an omitted `workspaceId` keeps where it lives. `pinned` omitted keeps it (false when
   * adding).
   */
  save_memory_entry: {
    params: {
      id?: string;
      text: string;
      tag?: string | null;
      workspaceId?: string | null;
      pinned?: boolean;
    };
    result: MemoryEntry;
  };
  delete_memory_entry: { params: { id: string }; result: void };
  /** Reverses a background memory pass; a note changed since then is left alone. */
  undo_memory_pass: { params: { passId: string }; result: { undone: number } };
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
  /** Every Telegram account, in the order they were added. */
  list_telegram_accounts: { params: NoParams; result: TelegramStatus[] };
  /** Changes an account, or adds one when `config.accountId` is omitted. */
  save_telegram: { params: { config: SaveTelegramInput }; result: TelegramStatus };
  /** Opens a pairing window for one account and returns its status with the one-time code. */
  start_telegram_pairing: { params: { accountId: string }; result: TelegramStatus };
  /** Removes one account (its token, owner and settings) and stops it; returns the ones left. */
  forget_telegram: { params: { accountId: string }; result: TelegramStatus[] };
  /** Every Zalo account, in the order they were added. */
  list_zalo_accounts: { params: NoParams; result: ZaloStatus[] };
  /** Changes an account, or adds one when `config.accountId` is omitted. */
  save_zalo: { params: { config: SaveZaloInput }; result: ZaloStatus };
  /** Opens a pairing window for one account and returns its status with the one-time code. */
  start_zalo_pairing: { params: { accountId: string }; result: ZaloStatus };
  /** Removes one account (its token, owner and settings) and stops it; returns the ones left. */
  forget_zalo: { params: { accountId: string }; result: ZaloStatus[] };

  /** Default profile first, then by name. */
  list_browser_profiles: { params: NoParams; result: BrowserProfile[] };
  /** Adds a profile (`id` omitted) or renames one. */
  save_browser_profile: { params: { profile: SaveBrowserProfileInput }; result: BrowserProfile };
  /** The default profile cannot be deleted. The app clears the deleted profile's sign-ins. */
  delete_browser_profile: { params: { id: string }; result: void };
  /** Records a finished cookie import, so the profile shows where its sign-ins came from. */
  record_browser_import: {
    params: { id: string; lastImport: BrowserProfileImport };
    result: BrowserProfile;
  };

  list_computer_apps: { params: NoParams; result: ComputerAppAccess };
  /** Moves an app to the always-allowed or the blocked list, or (`access` null) off both. */
  set_computer_app_access: {
    params: { app: ComputerApp; access: "allowed" | "blocked" | null };
    result: ComputerAppAccess;
  };

  get_remote_access: { params: NoParams; result: RemoteAccessStatus };
  /** Turns the web app on the local network on or off; `port` omitted keeps the current one. */
  set_remote_access: { params: { enabled: boolean; port?: number }; result: RemoteAccessStatus };
  /** Opens a pairing window and returns the status with the one-time code. */
  start_remote_pairing: { params: NoParams; result: RemoteAccessStatus };
  /** Signs a paired device out; it must pair again. */
  forget_remote_device: { params: { id: string }; result: RemoteAccessStatus };
}

export type AgentCommandType = keyof AgentCommandMap;
export type AgentCommand = {
  [K in AgentCommandType]: { type: K } & AgentCommandMap[K]["params"];
}[AgentCommandType];
export type AgentCommandResult<K extends AgentCommandType> = AgentCommandMap[K]["result"];

// ---------------------------------------------------------------------------------------------
// Side panel: terminal, workspace files, and browser
// ---------------------------------------------------------------------------------------------

/** A shell the person opened in the side panel. It runs in the main process, never for the agent. */
export interface TerminalInfo {
  id: string;
  /** Workspace folder it started in; the panel shows the terminals of the open conversation's. */
  cwd: string;
  title: string;
  /** The shell ended; the output stays readable until the terminal is closed. */
  exited: boolean;
}

export interface TerminalSize {
  cols: number;
  rows: number;
}

/** Output written so far (the most recent part), and the sequence number of its last chunk. */
export interface TerminalBacklog {
  output: string;
  seq: number;
}

/** One file or folder of a workspace; `path` is relative to the workspace folder, with `/`. */
export interface WorkspaceEntry {
  name: string;
  path: string;
  kind: "file" | "folder";
  size: number;
  /** Last change, epoch milliseconds. */
  modified: number;
}

/**
 * Scheme the desktop app serves HTML previews from (`apps/desktop/src/main/artifact-protocol.ts`):
 * the sandboxed frame page and a few bundled libraries, nothing else.
 */
export const ARTIFACT_SCHEME = "pp-artifact";
/** Page the preview iframe loads; the renderer then posts it the HTML to show. */
export const ARTIFACT_FRAME_URL = `${ARTIFACT_SCHEME}://frame/`;
/** Libraries an HTML preview may load; the model is told these addresses. */
export const ARTIFACT_LIBS = {
  chartjs: `${ARTIFACT_SCHEME}://lib/chart.js`,
} as const;

export type FilePreview =
  | { kind: "text"; text: string; truncated: boolean; size: number }
  | { kind: "image"; dataUrl: string; size: number }
  /** Too large or not text: offer to show it in Finder / Explorer instead. */
  | { kind: "none"; size: number };

/** Id of the profile every browser tab uses unless the person picks another. */
export const DEFAULT_BROWSER_PROFILE_ID = "default";

export const BROWSER_PROFILE_LIMITS = { maxProfiles: 20, maxNameLength: 40 } as const;

/** Browsers installed on the computer whose cookies can be copied into a profile. */
export const COOKIE_SOURCE_BROWSERS = [
  "chrome",
  "edge",
  "brave",
  "arc",
  "chromium",
  "firefox",
] as const;
export type CookieSourceBrowser = (typeof COOKIE_SOURCE_BROWSERS)[number];

/** Product names, shown as they are in every language. */
export const COOKIE_SOURCE_NAMES: Record<CookieSourceBrowser, string> = {
  chrome: "Google Chrome",
  edge: "Microsoft Edge",
  brave: "Brave",
  arc: "Arc",
  chromium: "Chromium",
  firefox: "Firefox",
};

/** Where a profile's cookies were last copied from. */
export interface BrowserProfileImport {
  browser: CookieSourceBrowser;
  /** Name of the source browser's own profile ("Person 1", "default-release"). */
  sourceProfile: string;
  /** Epoch milliseconds. */
  at: number;
  count: number;
}

/**
 * A separate set of sign-ins, cookies and site data for the side panel browser. The daemon keeps
 * the list (so a future browser tool of the agent can pick a profile); the main process keeps the
 * data itself, in an Electron partition per profile.
 */
export interface BrowserProfile {
  id: string;
  name: string;
  createdAt: number;
  lastImport: BrowserProfileImport | null;
}

/** Omit `id` to create a profile. */
export interface SaveBrowserProfileInput {
  id?: string;
  name: string;
}

/** A profile of an installed browser; `id` is its folder name. */
export interface CookieSourceProfile {
  id: string;
  name: string;
}

export interface CookieSource {
  browser: CookieSourceBrowser;
  profiles: CookieSourceProfile[];
}

/**
 * A site with cookies in a source browser profile (`google.com` for `mail.google.com` and
 * `.google.com`), for picking which sign-ins to import.
 */
export interface CookieSite {
  site: string;
  /** Cookies of the site and its subdomains. */
  count: number;
}

export interface CookieImportResult {
  imported: number;
  /** Expired, unreadable, or refused by the browser engine. */
  skipped: number;
  profile: BrowserProfile;
}

/** One tab of the browser, shown in the side panel or the main area. `id` stays the same for the tab's life. */
export interface BrowserTab {
  id: string;
  profileId: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface BrowserState {
  tabs: BrowserTab[];
  activeId: string | null;
}

export type BrowserAction = "back" | "forward" | "reload" | "stop";

// ---------------------------------------------------------------------------------------------
// Browser use: the agent's `browser` tool, run by the window's side panel browser
// ---------------------------------------------------------------------------------------------

/** Actions of the agent's `browser` tool. `tab` omitted means the active tab. */
export const BROWSER_TOOL_ACTIONS = [
  "tabs",
  "open",
  "select",
  "close",
  "navigate",
  "back",
  "forward",
  "reload",
  "snapshot",
  "text",
  "screenshot",
  "click",
  "type",
  "press",
  "select_option",
  "scroll",
  "wait",
  "eval",
] as const;
export type BrowserToolAction = (typeof BROWSER_TOOL_ACTIONS)[number];

/** One call of the `browser` tool, as the daemon hands it to the window. */
export interface BrowserRequest {
  action: BrowserToolAction;
  tab?: string;
  /** `open`, `navigate`: an address, or words to search for. */
  url?: string;
  /** `open`: profile name or id; the default profile when omitted. */
  profile?: string;
  /** Element reference from the last `snapshot` (`e12`). */
  ref?: string;
  /** `type`: the text; `wait`: text to wait for. */
  text?: string;
  /** `type`: press Enter afterwards. */
  submit?: boolean;
  /** `type`: replace what the field holds (default true). */
  clear?: boolean;
  /** `press`: a key such as `Enter`, `Escape`, `ArrowDown`, `Control+A`. */
  key?: string;
  /** `select_option`: option values or labels. */
  values?: string[];
  /** `scroll`. */
  direction?: "up" | "down";
  /** `eval`: JavaScript run in the page. */
  expression?: string;
  /** `wait`: milliseconds. */
  ms?: number;
  /** `text`: character to continue from. */
  offset?: number;
}

/** What the tool returns to the model: page text (untrusted web content) and maybe an image. */
export interface BrowserResult {
  text: string;
  /** Base64 image for `screenshot`. */
  image?: string;
  imageType?: "image/png" | "image/jpeg";
}

/** Rectangle of the page area in the window, in CSS pixels. */
export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------------------------
// Computer use: the agent's `computer` tool, run by the window through cua-driver
// ---------------------------------------------------------------------------------------------

/** Actions of the agent's `computer` tool. Every action but `apps` names an app. */
export const COMPUTER_TOOL_ACTIONS = [
  "apps",
  "windows",
  "snapshot",
  "screenshot",
  "launch",
  "click",
  "double_click",
  "right_click",
  "type",
  "set_value",
  "press",
  "hotkey",
  "scroll",
  "drag",
  "menu",
] as const;
export type ComputerToolAction = (typeof COMPUTER_TOOL_ACTIONS)[number];

/** Actions that only look; the others change something and are write tier. */
export const COMPUTER_READ_ACTIONS: readonly ComputerToolAction[] = [
  "apps",
  "windows",
  "snapshot",
  "screenshot",
];

/** An app on the computer: `id` is its bundle id (macOS), else what cua-driver names it by. */
export interface ComputerApp {
  id: string;
  name: string;
}

/** Apps the person allowed for every conversation, and apps the agent may never use. */
export interface ComputerAppAccess {
  allowed: ComputerApp[];
  blocked: ComputerApp[];
}

export const COMPUTER_APP_LIMITS = { maxApps: 200, maxIdLength: 300, maxNameLength: 120 } as const;

/** How long a first-use approval of an app lasts; omitted means this call only. */
export type ComputerAppRemember = "conversation" | "always";

/**
 * Apps the agent may never drive, by bundle id (lower case) or name: PP Agent itself (it would
 * approve its own requests), terminals, script runners and editors with a built-in terminal (they
 * would get around the shell setting), Task Manager ("Run new task"), and where macOS and Windows
 * keep passwords and privacy switches. Finder and Explorer stay usable, though opening a script or
 * program file there runs it: approving them is close to approving the shell.
 */
const PROTECTED_COMPUTER_APP_IDS = new Set([
  "com.pptechs.agent",
  "com.github.electron",
  "com.apple.terminal",
  "com.googlecode.iterm2",
  "com.mitchellh.ghostty",
  "dev.warp.warp-stable",
  "net.kovidgoyal.kitty",
  "org.alacritty",
  "io.alacritty",
  "com.github.wez.wezterm",
  "co.zeit.hyper",
  "com.apple.scripteditor2",
  "com.apple.automator",
  "com.apple.shortcuts",
  "com.apple.systempreferences",
  "com.apple.keychainaccess",
  "com.apple.passwords",
  "com.apple.securityagent",
  "com.1password.1password",
  "com.agilebits.onepassword7",
  "com.bitwarden.desktop",
  "com.microsoft.vscode",
  "com.microsoft.vscodeinsiders",
  "com.vscodium",
  "com.todesktop.230313mzl4w4u92",
  "com.exafunction.windsurf",
  "dev.zed.zed",
]);
/** Id prefixes: app families (JetBrains IDEs) and Windows package names (`<name>_<publisher>!App`). */
const PROTECTED_COMPUTER_APP_ID_PREFIXES = [
  "com.jetbrains.",
  "microsoft.windowsterminal",
  "microsoft.powershell",
  "microsoft.visualstudiocode",
  "microsoft.wsl",
  "microsoftcorporationii.windowssubsystemforlinux",
  "canonicalgrouplimited.ubuntu",
  "thedebianproject.debianlinux",
];
const PROTECTED_COMPUTER_APP_NAMES = new Set([
  "pp agent",
  "electron",
  "terminal",
  "iterm2",
  "ghostty",
  "warp",
  "kitty",
  "alacritty",
  "wezterm",
  "hyper",
  "script editor",
  "automator",
  "shortcuts",
  "system settings",
  "system preferences",
  "keychain access",
  "passwords",
  "1password",
  "bitwarden",
  "windows terminal",
  "command prompt",
  "windows powershell",
  "powershell",
  "cmd",
  "pwsh",
  "wt",
  "conhost",
  "registry editor",
  "regedit",
  "windows security",
  "settings",
  "visual studio code",
  "code",
  "code - insiders",
  "vscodium",
  "cursor",
  "windsurf",
  "zed",
  "git bash",
  "git-bash",
  "bash",
  "wsl",
  "windows subsystem for linux",
  "debian",
  "task manager",
  "taskmgr",
]);
/** Name prefixes, for names that carry a version or edition ("PowerShell 7 (x64)", "Ubuntu 24.04 LTS"). */
const PROTECTED_COMPUTER_APP_NAME_PREFIXES = ["powershell", "ubuntu", "visual studio code"];

export function isProtectedComputerApp(app: ComputerApp): boolean {
  const id = app.id.trim().toLowerCase();
  const name = app.name
    .trim()
    .toLowerCase()
    .replace(/\.(exe|app)$/, "");
  // A Windows launch path (`C:\…\Code.exe`) also counts by its program name.
  const program = (id.split(/[\\/]/).pop() ?? "").replace(/\.(exe|app)$/, "");
  return (
    PROTECTED_COMPUTER_APP_IDS.has(id) ||
    PROTECTED_COMPUTER_APP_ID_PREFIXES.some((prefix) => id.startsWith(prefix)) ||
    PROTECTED_COMPUTER_APP_NAMES.has(name) ||
    PROTECTED_COMPUTER_APP_NAMES.has(program) ||
    PROTECTED_COMPUTER_APP_NAME_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

/** One call of the `computer` tool, as the daemon hands it to the window. */
export interface ComputerRequest {
  action: ComputerToolAction;
  /** App id from `apps`; required by every action but `apps`. */
  app?: string;
  /** Window id from `windows`; the app's frontmost window when omitted. */
  window?: number;
  /** Element token from the latest `snapshot` of that window (`s0000002a:11`). */
  ref?: string;
  /** Pixels in the latest screenshot of the window, for elements missing from the snapshot. */
  x?: number;
  y?: number;
  /** `drag`: where to release, in the same pixels. */
  toX?: number;
  toY?: number;
  /** `type`: the text. */
  text?: string;
  /** `set_value`: the value for a pop-up, checkbox or slider. */
  value?: string;
  /** `press`: one key such as `return`, `escape`, `down`, `tab`. */
  key?: string;
  /** `hotkey`: a key combination such as `["cmd", "s"]`. */
  keys?: string[];
  /** `menu`: the application menu path, such as `["File", "Export…"]`. */
  path?: string[];
  /** `scroll`. */
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  /** `snapshot`: only rows that contain these words, with their parents. */
  query?: string;
  /** `snapshot`: include the screenshot (default false; `screenshot` returns only the image). */
  image?: boolean;
  /** Bring the window to the front for this step, then put the person's app back. */
  foreground?: boolean;
}

/** What the tool returns to the model: screen text (untrusted) and maybe a PNG. */
export interface ComputerResult {
  text: string;
  /** Base64 PNG or JPEG of the window. */
  image?: string;
  imageType?: "image/png" | "image/jpeg";
  /** Apps this call saw (`apps`, `launch`), so approvals can name them. */
  apps?: ComputerApp[];
}

/** Whether the window can drive apps right now, for Settings › Computer use. */
export interface ComputerStatus {
  /** False on platforms cua-driver does not run on here, or when the app was built without it. */
  supported: boolean;
  /** macOS grants of PP Agent; always true elsewhere. */
  accessibility: boolean;
  screenRecording: boolean;
}

/**
 * Where the app stands with updates. `in-app` updates download and install from inside the app
 * (Windows, and macOS builds signed with a Developer ID certificate); `download-page` ones open the
 * release page (macOS builds that are not signed, and `.deb` installs, which belong to the system).
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
  /**
   * `desktop`: the app window, through the preload. `web`: a browser on the local network (a phone),
   * talking to the daemon over HTTP; it has no side panel, native dialogs, updates or computer use.
   */
  kind: "desktop" | "web";
  agent: {
    command<C extends AgentCommand>(command: C): Promise<AgentCommandResult<C["type"]>>;
    onEvent(listener: (event: AgentEvent) => void): () => void;
    /**
     * Stops the running agent daemon and starts one from this app's build, so a daemon left by an
     * earlier version is dropped even when its version string matched. Resolves once the new one
     * answers. Desktop only; a phone's request is refused.
     */
    restartDaemon(): Promise<void>;
  };
  files: {
    /** Opens the system file picker. */
    pick(): Promise<Attachment[]>;
    /** Picks a skill folder or a .zip/.skill archive; null when cancelled. */
    pickSkill(): Promise<string | null>;
    /** Path of a dropped `File`, or "" when it has none (for example, pasted data). */
    pathFor(file: File): string;
    /** Web only: copies a file from the device to the computer and returns it as an attachment. */
    upload?(file: File): Promise<Attachment>;
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
    /** Picks a configuration bundle and returns its text; null when cancelled. */
    openConfigFile(): Promise<string | null>;
    /** Asks where to save a configuration bundle; false when cancelled. */
    saveConfigFile(suggestedName: string, json: string): Promise<boolean>;
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
  /**
   * Desktop only: this app as a client of another computer (Settings › Remote access). Opens that
   * computer's web app in its own window, pairing when the address carries a pairing code.
   */
  client?: {
    open(address: string): Promise<void>;
  };
  shell: {
    /** The global shortcut fired: the window is in front, focus the message box. */
    onFocusComposer(listener: () => void): () => void;
    /** True once when the window was created by the shortcut and missed the event; clears it. */
    takePendingFocus(): Promise<boolean>;
    /** The side panel shortcut was pressed while a browser page had the keyboard. */
    onTogglePanel(listener: () => void): () => void;
    /** The new tab shortcut (Cmd+T / Ctrl+T) was pressed while a browser page had the keyboard. */
    onNewTab(listener: () => void): () => void;
    /** Cmd+W / Ctrl+W was pressed in the app window; the app decides whether it closes a tab. */
    onCloseTab(listener: () => void): () => void;
    /** Closes the app window (as Cmd+W / Ctrl+W did before the app handled it). */
    closeWindow(): Promise<void>;
  };
  terminal: {
    list(): Promise<TerminalInfo[]>;
    /** Starts the person's shell in a workspace folder. */
    create(cwd: string, size: TerminalSize): Promise<TerminalInfo>;
    /**
     * Output so far, for a view that starts showing the terminal. The view then acks every chunk
     * it has drawn (`ack`); the shell pauses while too much output waits, until `detach`.
     */
    backlog(id: string): Promise<TerminalBacklog>;
    /** The view drew `chars` more characters of this terminal's output. */
    ack(id: string, chars: number): void;
    /** The view stopped showing the terminal: its output is no longer held back for it. */
    detach(id: string): void;
    write(id: string, data: string): void;
    resize(id: string, size: TerminalSize): void;
    close(id: string): Promise<void>;
    /** Output of every terminal; `seq` increases per terminal, so a backlog can skip repeats. */
    onData(listener: (id: string, data: string, seq: number) => void): () => void;
    /** A terminal was added, closed, renamed, or its shell ended. */
    onChanged(listener: (terminals: TerminalInfo[]) => void): () => void;
  };
  workspace: {
    /** Entries of a folder inside the workspace `root` (`dir` relative, "" for the root). */
    list(root: string, dir: string): Promise<WorkspaceEntry[]>;
    preview(root: string, path: string): Promise<FilePreview>;
    reveal(root: string, path: string): Promise<void>;
    /** The file as an attachment for the message box. */
    attachment(root: string, path: string): Promise<Attachment>;
    /** Creates an empty file or folder named `name` inside `dir`; resolves to its path. */
    create(root: string, dir: string, name: string, kind: "file" | "folder"): Promise<string>;
    /** Renames the file or folder at `path` within its folder; resolves to the new path. */
    rename(root: string, path: string, name: string): Promise<string>;
    /** Moves the file or folder to the system trash. */
    remove(root: string, path: string): Promise<void>;
    /** Saves an HTML preview from the chat as a new file in `artifacts/`; resolves to its path. */
    saveArtifact(root: string, html: string): Promise<string>;
    /** Watches `root` for changes (replacing the previous watch); null stops watching. */
    watch(root: string | null): Promise<void>;
    onChanged(listener: (root: string) => void): () => void;
  };
  browser: {
    state(): Promise<BrowserState>;
    /** Opens a tab with a profile and makes it the active one. */
    open(profileId: string, url?: string): Promise<BrowserTab>;
    close(id: string): Promise<void>;
    activate(id: string): Promise<void>;
    /** Goes to an address, or searches the web for anything that is not one. */
    navigate(id: string, input: string): Promise<void>;
    go(id: string, action: BrowserAction): Promise<void>;
    /**
     * Where a tab's page is drawn; null hides it (its view is not showing, a dialog on top).
     * Several tabs can be shown at once, each in its own area.
     */
    setBounds(id: string, bounds: BrowserBounds | null): void;
    onState(listener: (state: BrowserState) => void): () => void;
    /** The agent is using a tab: show it, in the main area if the tab is there, else in the side panel. */
    onReveal(listener: (id: string) => void): () => void;
    /** Installed browsers and their profiles whose cookies can be imported. */
    cookieSources(): Promise<CookieSource[]>;
    /**
     * Whether the source browser is running and so keeps its cookies locked. Only told on Windows,
     * where closing its windows may leave it running in the background.
     */
    cookieSourceRunning(browser: CookieSourceBrowser): Promise<boolean>;
    /**
     * The sites with cookies in a source browser profile, most cookies first. `quitSource` first
     * quits the source browser, with its background processes (Windows).
     */
    cookieSites(
      browser: CookieSourceBrowser,
      sourceProfile: string,
      quitSource?: boolean,
    ): Promise<CookieSite[]>;
    /** Copies the cookies of the chosen sites (from `cookieSites`) of a source browser profile into a profile. */
    importCookies(
      profileId: string,
      browser: CookieSourceBrowser,
      sourceProfile: string,
      sites: string[],
    ): Promise<CookieImportResult>;
  };
  computer: {
    status(): Promise<ComputerStatus>;
    /** Asks macOS for the grants PP Agent lacks, or opens their System Settings pane. */
    requestPermissions(): Promise<ComputerStatus>;
  };
  /**
   * The audit log: a local record of what went wrong and what the app did (errors, model
   * failures, approvals, connection drops), kept to hand to whoever debugs a problem. It never
   * holds what was said in a conversation.
   */
  diagnostics: {
    info(): Promise<DiagnosticsInfo>;
    /** Asks where to save the audit log with the daemon's log and system details; false when cancelled. */
    export(): Promise<boolean>;
    /** Shows the folder with the log files in Finder / Explorer. */
    reveal(): Promise<void>;
    clear(): Promise<void>;
    /** Records an error of the page itself (an uncaught exception). Never rejects. */
    report(report: RendererReport): void;
  };
}

export interface DiagnosticsInfo {
  /** The audit log file. */
  file: string;
  /** Bytes the audit log takes, rotated file included. */
  size: number;
}

/** An error the page raised that nobody handled. */
export interface RendererReport {
  kind: "error" | "unhandledrejection";
  message: string;
  stack?: string;
}

export const IPC = {
  agentCommand: "agent:command",
  agentRestartDaemon: "agent:restart-daemon",
  agentEvent: "agent:event",
  filesPick: "files:pick",
  filesPickSkill: "files:pick-skill",
  filesOpenWorkspace: "files:open-workspace",
  filesReveal: "files:reveal",
  filesPickFolder: "files:pick-folder",
  filesOpenAgent: "files:open-agent",
  filesSaveAgent: "files:save-agent",
  filesOpenConfig: "files:open-config",
  filesSaveConfig: "files:save-config",
  filesSaveExport: "files:save-export",
  openExternal: "shell:open-external",
  clientOpen: "client:open",
  updatesState: "updates:state",
  updatesCheck: "updates:check",
  updatesDownload: "updates:download",
  updatesInstall: "updates:install",
  updatesEvent: "updates:event",
  shellFocusComposer: "shell:focus-composer",
  shellTakePendingFocus: "shell:take-pending-focus",
  shellTogglePanel: "shell:toggle-panel",
  shellNewTab: "shell:new-tab",
  shellCloseTab: "shell:close-tab",
  shellCloseWindow: "shell:close-window",
  terminalList: "terminal:list",
  terminalCreate: "terminal:create",
  terminalBacklog: "terminal:backlog",
  terminalWrite: "terminal:write",
  terminalResize: "terminal:resize",
  terminalAck: "terminal:ack",
  terminalDetach: "terminal:detach",
  terminalClose: "terminal:close",
  terminalData: "terminal:data",
  terminalChanged: "terminal:changed",
  workspaceList: "workspace:list",
  workspacePreview: "workspace:preview",
  workspaceReveal: "workspace:reveal",
  workspaceAttachment: "workspace:attachment",
  workspaceCreate: "workspace:create",
  workspaceRename: "workspace:rename",
  workspaceRemove: "workspace:remove",
  workspaceSaveArtifact: "workspace:save-artifact",
  workspaceWatch: "workspace:watch",
  workspaceChanged: "workspace:changed",
  browserState: "browser:state",
  browserOpen: "browser:open",
  browserClose: "browser:close",
  browserActivate: "browser:activate",
  browserNavigate: "browser:navigate",
  browserGo: "browser:go",
  browserSetBounds: "browser:set-bounds",
  browserChanged: "browser:changed",
  browserCookieSources: "browser:cookie-sources",
  browserCookieSourceRunning: "browser:cookie-source-running",
  browserCookieSites: "browser:cookie-sites",
  browserImportCookies: "browser:import-cookies",
  browserReveal: "browser:reveal",
  computerStatus: "computer:status",
  computerRequestPermissions: "computer:request-permissions",
  diagnosticsInfo: "diagnostics:info",
  diagnosticsExport: "diagnostics:export",
  diagnosticsReveal: "diagnostics:reveal",
  diagnosticsClear: "diagnostics:clear",
  diagnosticsReport: "diagnostics:report",
} as const;

// ---------------------------------------------------------------------------------------------
// Client ↔ daemon (pp-agentd)
// ---------------------------------------------------------------------------------------------

/** Bump when a frame below changes incompatibly; a client talking to another version shuts the daemon down. */
export const DAEMON_PROTOCOL = 4;

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
  /**
   * Asks the daemon to exit (an update replaced it, or the desktop app started it and is quitting).
   * `forUpdate` is set when the app is about to install an update: the daemon then leaves the login
   * service stopped too, because the installer cannot replace the program while any copy runs.
   */
  | { kind: "shutdown"; forUpdate?: boolean }
  /** Whether this client can run the agent's browser tool now (it has a window). */
  | { kind: "browser_available"; available: boolean }
  /** Answers a `browser_request`. */
  | { kind: "browser_response"; id: number; ok: true; result: BrowserResult }
  | { kind: "browser_response"; id: number; ok: false; error: string }
  /** Whether this client can run the agent's computer tool now (it has a window and cua-driver). */
  | { kind: "computer_available"; available: boolean }
  /** Answers a `computer_request`. */
  | { kind: "computer_response"; id: number; ok: true; result: ComputerResult }
  | { kind: "computer_response"; id: number; ok: false; error: string };

export type DaemonFrame =
  | { kind: "challenge"; nonce: string }
  | {
      kind: "hello_ok";
      protocol: number;
      appVersion: string;
      pid: number;
      /** True when an app spawned this daemon (a login-service or terminal one is false). */
      spawnedByApp?: boolean;
      proof: string;
    }
  | { kind: "hello_error"; error: string }
  | { kind: "event"; event: AgentEvent }
  | { kind: "result"; id: number; ok: true; data: unknown }
  | { kind: "result"; id: number; ok: false; error: string }
  | { kind: "open_url"; url: string }
  /** Asks one client that offered its browser to run a `browser` tool call. */
  | { kind: "browser_request"; id: number; request: BrowserRequest }
  /** Asks one client that offered computer use to run a `computer` tool call. */
  | { kind: "computer_request"; id: number; request: ComputerRequest }
  /**
   * The tool call stopped or timed out: the client stops that request if it still runs. A step
   * that already happened is not undone.
   */
  | { kind: "computer_cancel"; id: number };

/** Workspace folder (relative) that attached files are copied into. */
export const ATTACHMENTS_DIR = "attachments";
