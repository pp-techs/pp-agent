/**
 * Contract shared by the Electron main process, the agent utility process, and the renderer.
 * Everything crossing a process boundary is defined here so the three sides cannot drift.
 */

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
  role: "user" | "assistant";
  parts: ChatPart[];
  error?: string;
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

export type AgentStatus = "starting" | "unconfigured" | "idle" | "running";

export interface AgentSnapshot {
  status: AgentStatus;
  messages: ChatMessage[];
  approvals: ApprovalRequest[];
  model: string | null;
  workspaceDir: string | null;
  /** Session file of the open conversation. */
  sessionPath: string | null;
}

export type AgentEvent =
  | { type: "status"; status: AgentStatus }
  /** Insert or replace the message with this id. */
  | { type: "message"; message: ChatMessage }
  | { type: "snapshot"; snapshot: AgentSnapshot }
  | { type: "approval_requested"; request: ApprovalRequest }
  | { type: "approval_resolved"; requestId: string }
  /** The saved conversation list changed (new, renamed, deleted, or a turn finished). */
  | { type: "sessions_changed" }
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
  title: string;
  /** Last change, epoch milliseconds. */
  modified: number;
  messageCount: number;
}

export interface ToolSummary {
  name: string;
  description: string;
  /** `built-in`, or the MCP server the tool comes from. */
  source: string;
  tier: ToolTier;
}

type NoParams = Record<never, never>;

export interface AgentCommandMap {
  get_snapshot: { params: NoParams; result: AgentSnapshot };
  prompt: { params: { text: string; attachments: Attachment[] }; result: void };
  abort: { params: NoParams; result: void };
  new_chat: { params: NoParams; result: void };
  respond_approval: { params: { requestId: string; approved: boolean }; result: void };
  list_sessions: { params: NoParams; result: SessionSummary[] };
  open_session: { params: { path: string }; result: void };
  rename_session: { params: { path: string; name: string }; result: void };
  delete_session: { params: { path: string }; result: void };
  list_tools: { params: NoParams; result: ToolSummary[] };
}

export type AgentCommandType = keyof AgentCommandMap;
export type AgentCommand = {
  [K in AgentCommandType]: { type: K } & AgentCommandMap[K]["params"];
}[AgentCommandType];
export type AgentCommandResult<K extends AgentCommandType> = AgentCommandMap[K]["result"];

/** Wire APIs the gateway can speak; all are supported by pi-ai. */
export const PROVIDER_APIS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
] as const;
export type ProviderApi = (typeof PROVIDER_APIS)[number];

export interface ProviderSettings {
  api: ProviderApi;
  baseUrl: string;
  modelId: string;
}

/** What the renderer may see: never the key itself. */
export interface ProviderSettingsView extends ProviderSettings {
  hasApiKey: boolean;
}

export interface SaveProviderSettings extends ProviderSettings {
  /** Omit to keep the stored key. */
  apiKey?: string;
}

export interface ListModelsRequest {
  baseUrl: string;
  /** Omit to use the stored key. */
  apiKey?: string;
}

/** API exposed on `window.ppAgent` by the preload script. */
export interface DesktopBridge {
  agent: {
    command<C extends AgentCommand>(command: C): Promise<AgentCommandResult<C["type"]>>;
    onEvent(listener: (event: AgentEvent) => void): () => void;
  };
  settings: {
    get(): Promise<ProviderSettingsView | null>;
    save(settings: SaveProviderSettings): Promise<ProviderSettingsView>;
    listModels(request: ListModelsRequest): Promise<string[]>;
  };
  files: {
    /** Opens the system file picker. */
    pick(): Promise<Attachment[]>;
    /** Path of a dropped `File`, or "" when it has none (for example, pasted data). */
    pathFor(file: File): string;
    /** Opens the workspace folder in Finder / Explorer. */
    openWorkspace(): Promise<void>;
  };
}

export const IPC = {
  agentCommand: "agent:command",
  agentEvent: "agent:event",
  settingsGet: "settings:get",
  settingsSave: "settings:save",
  settingsListModels: "settings:list-models",
  filesPick: "files:pick",
  filesOpenWorkspace: "files:open-workspace",
} as const;

/** Messages between the main process and the agent utility process. */
export interface AgentPaths {
  workspaceDir: string;
  agentDir: string;
  sessionDir: string;
}

export interface ProviderConfig extends ProviderSettings {
  apiKey: string;
}

export type MainToAgentMessage =
  | { kind: "init"; paths: AgentPaths; provider: ProviderConfig | null }
  | { kind: "configure"; provider: ProviderConfig }
  | { kind: "command"; id: number; command: AgentCommand };

export type AgentToMainMessage =
  | { kind: "event"; event: AgentEvent }
  | { kind: "result"; id: number; ok: true; data: unknown }
  | { kind: "result"; id: number; ok: false; error: string };

/** Workspace folder (relative) that attached files are copied into. */
export const ATTACHMENTS_DIR = "attachments";
