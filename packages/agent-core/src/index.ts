/**
 * The agent host: runs the Pi SDK session and every command the UI can send. It knows nothing of
 * the process around it; `HostEnvironment` supplies the event sink, the vault, and service control.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Api, AssistantMessage, Credential, Model } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  type AgentSessionEvent,
  CredentialSynchronizationError,
  createAgentSession,
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
  DefaultResourceLoader,
  type ExtensionFactory,
  type ExtensionUIContext,
  ModelRuntime,
  parseSkillBlock,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  type AgentCommand,
  type AgentPaths,
  type AgentProfile,
  type AgentSnapshot,
  type ContextUsage,
  type AgentStatus,
  type AppSettings,
  type FetchedGatewayModel,
  type ApprovalRequest,
  type Attachment,
  type Question,
  type QuestionAnswer,
  type QuestionRequest,
  type SaveScheduledTaskInput,
  type ScheduledTask,
  type ScheduledTaskView,
  type ServiceStatus,
  type TaskRun,
  type TaskSchedule,
  type VoiceSettings,
  type VoiceView,
  DEFAULT_AGENT_ID,
  DEFAULT_WORKSPACE_ID,
  GATEWAY_APIS,
  isValidAccelerator,
  type GatewayConfig,
  type GatewayModel,
  type GatewayView,
  type StoredCredential,
  type McpServerSettings,
  type MemoryEntry,
  type MemoryView,
  type ModelRef,
  type ModelSummary,
  type ProviderSummary,
  type SaveAgentInput,
  type SaveWorkspaceInput,
  type SaveGatewayInput,
  type SaveSkillInput,
  type SkillSummary,
  type SessionExport,
  type SessionSearchHit,
  type SessionSummary,
  type SessionUsage,
  type SettingsPatch,
  type SettingsScope,
  THINKING_LEVELS,
  type ThinkingLevel,
  TOOL_POLICIES,
  type ToolPolicy,
  type ToolSummary,
  type WorkspaceProfile,
} from "@workspace/shared";
import {
  AGENT_ENTRY_TYPE,
  agentPromptSection,
  agentToolOptions,
  assertUniqueName,
  exportAgent,
  findAgent,
  newAgentId,
  parseAgentExport,
  sortAgents,
  summarizeAgent,
  uniqueName,
  validateAgentInput,
} from "./agents.ts";
import {
  assertUniqueName as assertUniqueWorkspaceName,
  findWorkspace,
  newWorkspaceId,
  prepareFolder,
  sortWorkspaces,
  summarizeWorkspace,
  validateWorkspaceInput,
  workspaceForCwd,
  workspacePromptSection,
} from "./workspaces.ts";
import {
  CHAT_IDLE_MS,
  channelTitle,
  ChatSessionMap,
  idleChats,
  KeyedQueue,
  turnResult,
  assistantText,
  chatAgentId,
} from "./channel-sessions.ts";
import { TelegramService } from "./channels/telegram/index.ts";
import type {
  ChannelGateway,
  ChannelInput,
  ChatChoices,
  ChatPick,
  ChatPickKind,
  TurnHooks,
  TurnResult,
} from "./channels/types.ts";
import { buildPrompt, splitAttachedFiles, withAttachedFiles } from "./attachments.ts";
import { AuthPrompts } from "./auth-prompts.ts";
import { pruneToolOutputs } from "./context.ts";
import { VaultCredentialStore } from "./credentials.ts";
import { createReadDocumentTool } from "./documents.ts";
import { createOfficeTools } from "./office/tools.ts";
import { configureResourcesDir, resourcePath } from "./resources.ts";
import { conversationToHtml, conversationToMarkdown, exportFileName } from "./export.ts";
import {
  branchEntries,
  chatEntryIds,
  endOfTurnEntry,
  pinKey,
  searchSessions,
  sessionTitle,
  summarizeUsage,
  userContent,
} from "./history.ts";
import { configureLanguage, currentLanguage, t } from "./i18n.ts";
import type { HostEnvironment, ServiceControl } from "./host-io.ts";
import { configureOutput, emit, errorMessage, openUrl } from "./ipc.ts";
import { buildOverview, McpCommands, McpConfigFile, McpRegistrations } from "./mcp.ts";
import { VaultMcpAuthStore } from "./mcp-auth.ts";
import {
  authInteraction,
  availableModels,
  fetchGatewayModels,
  findAvailable,
  gatewayNeedingKey,
  listProviders,
  newGatewayId,
  normalizeBaseUrl,
  summarizeModel,
  syncGateways,
} from "./providers.ts";
import { SettingsStore } from "./settings-store.ts";
import { newTaskId, runTitle, validateTaskInput } from "./scheduled-tasks.ts";
import { nextRun, Scheduler, schedulableOf } from "./scheduler.ts";
import { VoiceService } from "./transcription.ts";
import { SkillLibrary } from "./skills.ts";
import { seedBuiltInSkills } from "./skills-builtin.ts";
import { createDelegateTool, DELEGATE_TOOL } from "./subagent.ts";
import {
  createMemoryTools,
  MEMORY_FORGET_TOOL,
  MEMORY_TOOLS,
  MemoryStore,
  memorySection,
} from "./memory.ts";
import {
  activeToolsFor,
  agentAllowsTool,
  currentDateTimeTool,
  describeToolCall,
  helperTools,
  isListedTool,
  parseMcpToolName,
  planningSection,
  SHELL_TOOL,
  SYSTEM_PROMPT,
  toolRule,
  toolSelection,
  toolTier,
} from "./tools.ts";
import { createTodoTool } from "./todo.ts";
import {
  createScheduleTool,
  SCHEDULE_TOOL,
  type ScheduleHost,
  type TaskListEntry,
} from "./schedule-tool.ts";
import { createSessionsTool, SESSIONS_TOOL, type PeerRow } from "./sessions-tool.ts";
import {
  classifySession,
  historyLines,
  previewOf,
  sessionContextSection,
  sessionRef,
  type HistoryLine,
  type SessionKind,
  type SessionRow,
  type SessionVisibility,
} from "./session-index.ts";
import { ASK_TOOL, askSection, checkAnswers, createAskTool, type AskUser } from "./ask.ts";
import { Transcript } from "./transcript.ts";
import { createWebFetchTool, createWebSearchTool } from "./web/tools.ts";
import { WebSearchService } from "./web/search.ts";

/** Sent to the model when a message has attachments but no text. The model reads English. */
const ATTACHMENTS_ONLY_PROMPT = "Please take a look at the attached files.";

/** What a prompt sends to the model: text (with the attached-files block) and inline images. */
type PromptMessage = Awaited<ReturnType<typeof buildPrompt>>;

/** Changes to apply to the open conversation once no run is active. */
interface PendingChanges {
  /** Skills, the agent's skill list: reload the session's resources and extensions. */
  reload: boolean;
  /** Tool policies, shell, the agent's tool list: update the active tool set. */
  tools: boolean;
  /** Providers, gateways: make sure the conversation still has a usable model. */
  model: boolean;
  /** mcp.json, the agent's servers: connect and disconnect MCP servers. */
  mcp: boolean;
  /** The conversation's workspace was deleted: move to the default workspace's folder. */
  workspace: boolean;
  /** The conversation switched to an agent with its own model: use that model. */
  agentModel: boolean;
}

const NO_CHANGES: PendingChanges = {
  reload: false,
  tools: false,
  model: false,
  mcp: false,
  workspace: false,
  agentModel: false,
};

/** Everything that exists once `init` has finished. */
interface Services {
  paths: AgentPaths;
  runtime: ModelRuntime;
  settings: SettingsStore;
  skills: SkillLibrary;
  webSearch: WebSearchService;
  mcpConfig: McpConfigFile;
  /** Long-term notes shared by every conversation (`memory.json` next to settings.json). */
  memory: MemoryStore;
  /** MCP servers connected for the open conversation's agent. */
  mcpServers: McpRegistrations;
  /** Speech to text for the message box. */
  voice: VoiceService;
  /** Which saved conversation each chat of a channel continues (`channels.json`). */
  chatSessions: ChatSessionMap;
}

/**
 * What one Pi session is built for: the open conversation, or a headless scheduled run. The agent
 * and workspace decide its model, tools, skills, and prompt; `mcpServers` connects the agent's
 * servers for this session alone.
 */
interface SessionScope {
  agent: () => AgentProfile;
  workspace: () => WorkspaceProfile;
  mcpServers: McpRegistrations;
  approvalGate: ExtensionFactory;
  /**
   * How `ask_user` reaches the person. Absent when nobody can answer (a scheduled run): the tool is
   * then not offered at all.
   */
  askUser?: AskUser;
  /** Extra system prompt section: headless runs tell the model nobody is watching, chats where it replies. */
  systemNote?: { section: string; text: string };
  /** What kind of session this is and how the model should call it ("a Telegram chat"). */
  surface: { kind: SessionKind; label: string };
  /** Which saved sessions the `sessions` tool shows: every one, or only the one running. */
  visibility: SessionVisibility;
}

/** What a chat's turn is doing right now; the session events and the approval gate read it. */
interface ChatTurn {
  hooks: TurnHooks;
  /** Finished assistant messages' text, in order; the streamed text is these plus the live one. */
  texts: string[];
  /** The last assistant message of the turn. */
  reply?: AssistantMessage;
}

interface ChatRuntime {
  turn: ChatTurn | null;
  /** Approvals waiting on the person in the chat; `false` is sent when the turn stops. */
  pending: Set<(approved: boolean) => void>;
  /** Questions of `ask_user` waiting on the person in the chat; each settles as skipped. */
  cancelQuestions: Set<() => void>;
  /** The person stopped the turn. */
  stopped: boolean;
}

/** A chat's own Pi session, apart from the conversation open in the window. */
type ChatSession = ChatRuntime & {
  session: AgentSession;
  mcpServers: McpRegistrations;
  unsubscribe: () => void;
  /** Agent and workspace the session was built for; a change in Settings rebuilds it. */
  agentId: string;
  workspaceId: string;
};

/** How often idle chat sessions are looked for. */
const CHAT_SWEEP_MS = 60_000;

/** System prompt section of a chat session: where the answer is shown. */
function channelNote(label: string): string {
  return [
    `You are replying to the person through ${label}, in a chat on their phone.`,
    "Keep answers short and plain; avoid long tables and heavy formatting.",
    "Tools that need the person's approval will ask them in this chat; wait for the answer.",
  ].join("\n");
}

/** Pi's error when the messages it keeps already cover the whole conversation. */
const NOTHING_TO_COMPACT = /nothing to compact/i;
/** Pi's default `compaction.keepRecentTokens`; manual compaction retries with less. */
const DEFAULT_KEEP_TOKENS = 20_000;
const MANUAL_KEEP_TOKENS = 2_000;
/** A scheduled run that takes longer than this is stopped and recorded as failed. */
const TASK_RUN_LIMIT_MS = 30 * 60_000;
/** Why a tool call was blocked in a scheduled run; the model sees it as the tool result. */
const SCHEDULED_DENIED_REASON =
  "Nobody is available to approve this action because this is a scheduled run, so it was not carried out. Continue without it and mention it in your answer.";

/** System prompt section of a scheduled run: nobody is watching, and what that means. */
function formatSchedule(schedule: TaskSchedule): string {
  if (schedule.kind === "once") return `once at ${new Date(schedule.at).toISOString()}`;
  if (schedule.kind === "interval") return `every ${schedule.every} ${schedule.unit}`;
  if (schedule.kind === "daily") return `daily at ${schedule.time}`;
  return `weekly on [${schedule.days.join(",")}] at ${schedule.time}`;
}

function scheduledTaskNote(name: string): string {
  return [
    `This is the scheduled task "${name}". It runs automatically without anyone watching, so you cannot ask questions or wait for answers.`,
    "Do the task with what you have and write a complete answer the person reads later.",
    "Tools that need the person's approval are denied in this run. If one is denied, do not retry it; finish without it and say what you could not do.",
  ].join("\n");
}

export class AgentHost {
  private services: Services | null = null;
  private readonly ready = Promise.withResolvers<Services>();
  readonly credentials: VaultCredentialStore;
  /**
   * Encrypted home of MCP sign-in tokens; null when the OS cannot encrypt, and Pi keeps its plain
   * `mcp-auth.json` (the MCP section tells the person).
   */
  private mcpAuth: VaultMcpAuthStore | null = null;
  private readonly prompts = new AuthPrompts();
  private readonly mcp = new McpCommands(this.prompts);
  private gatewayIds = new Set<string>();
  private session: AgentSession | null = null;
  /** Agent of the open conversation; resolves to the default agent once deleted. */
  private agentId: string = DEFAULT_AGENT_ID;
  /** Workspace of the open conversation; resolves to the default workspace once deleted. */
  private workspaceId: string = DEFAULT_WORKSPACE_ID;
  private unsubscribe: (() => void) | null = null;
  private running = false;
  private status: AgentStatus = "starting";
  private pending: PendingChanges = { ...NO_CHANGES };
  /** Applying changes to the session happens one batch at a time. */
  private applying: Promise<void> = Promise.resolve();
  private readonly approvals = new Map<
    string,
    { request: ApprovalRequest; resolve: (approved: boolean) => void }
  >();
  /** Questions of `ask_user` in the open conversation that wait for an answer. */
  private readonly questions = new Map<
    string,
    { request: QuestionRequest; resolve: (answers: QuestionAnswer[] | null) => void }
  >();
  private readonly transcript = new Transcript((message) => emit({ type: "message", message }));
  /** Runs scheduled tasks one at a time, each in its own Pi session. */
  private scheduler: Scheduler | null = null;
  /** Session of the scheduled task being run, by task id, so deleting the task can stop it. */
  private readonly taskSessions = new Map<string, AgentSession>();
  /** Telegram bot; null until the services are ready. */
  private telegram: TelegramService | null = null;
  /** Open Pi sessions of chats by chat key (`telegram:<id>`); idle ones are released. */
  private readonly chats = new Map<string, ChatSession>();
  /** When each open chat session last finished a turn. */
  private readonly chatUsed = new Map<string, number>();
  /** One turn at a time per chat. */
  private readonly chatQueue = new KeyedQueue();
  /** Turns of each chat that are running or waiting; a model or level cannot change meanwhile. */
  private readonly turnsPending = new Map<string, number>();
  private chatSweep: NodeJS.Timeout | null = null;

  /** What chat channels use to talk to the agent. */
  readonly gateway: ChannelGateway = {
    runTurn: (chatKey, input, hooks) => {
      this.turnsPending.set(chatKey, (this.turnsPending.get(chatKey) ?? 0) + 1);
      return this.chatQueue
        .run(chatKey, () => this.chatTurn(chatKey, input, hooks))
        .finally(() => {
          const left = (this.turnsPending.get(chatKey) ?? 1) - 1;
          if (left > 0) this.turnsPending.set(chatKey, left);
          else this.turnsPending.delete(chatKey);
        });
    },
    newConversation: (chatKey) => this.newChat(chatKey),
    abort: (chatKey) => this.abortChat(chatKey),
    options: async (chatKey) => this.chatOptions(chatKey),
    choose: (chatKey, choice) => this.chooseForChat(chatKey, choice),
    pickOptions: (chatKey, kind) => this.chatPickOptions(chatKey, kind),
    pick: (chatKey, kind, id) => this.chatPick(chatKey, kind, id),
    // The size limit applies; the length of a Telegram voice note is not known here.
    transcribe: (data, mimeType) =>
      this.requireServices().voice.transcribe(Buffer.from(data).toString("base64"), mimeType, 0),
    listChatSessions: async (chatKey) => {
      const { chatSessions, paths } = this.requireServices();
      const currentFile = chatSessions.get(chatKey);
      const historyFiles = chatSessions.history(chatKey);
      const allFiles = currentFile ? [currentFile, ...historyFiles] : historyFiles;
      const infos = await SessionManager.listAll(paths.sessionDir);
      const infoByPath = new Map(infos.map((info) => [info.path, info]));
      return allFiles.flatMap((file) => {
        const info = infoByPath.get(file);
        if (!info && file !== currentFile) return [];
        return [
          {
            id: sessionRef(file),
            title: info
              ? sessionTitle(info.name, info.firstMessage, this.titleFallbacks())
              : t("conversations.untitled"),
            isCurrent: file === currentFile,
          },
        ];
      });
    },
    resumeChatSession: async (chatKey, sessionId) => {
      const { chatSessions, paths } = this.requireServices();
      const infos = await SessionManager.listAll(paths.sessionDir);
      const info = infos.find((i) => sessionRef(i.path) === sessionId);
      if (!info) throw new Error(`Session ${sessionId} not found.`);
      if (!chatSessions.resume(chatKey, info.path))
        throw new Error(`Session ${sessionId} is not in this chat's history.`);
      this.closeChat(chatKey);
    },
    steerTurn: async (chatKey, input) => {
      const chat = this.chats.get(chatKey);
      if (!chat?.turn || !chat.session.isStreaming) return false;
      const message = await buildPrompt(
        input.text || ATTACHMENTS_ONLY_PROMPT,
        input.attachments,
        chat.session.sessionManager.getCwd(),
      );
      // Attachment preparation can outlive the running turn or streaming state.
      if (!chat.turn || this.chats.get(chatKey) !== chat || !chat.session.isStreaming) return false;
      // Steering joins the running turn at the next tool boundary.
      await chat.session.prompt(message.text, {
        images: message.images,
        streamingBehavior: "steer",
      });
      return true;
    },
  };

  /** Registers the daemon with the OS as a login service; the service commands call it. */
  readonly service: ServiceControl;

  constructor(environment: HostEnvironment) {
    configureOutput(environment.output);
    this.credentials = new VaultCredentialStore(environment.vault);
    this.service = environment.service;
    // Commands wait for `ready`; a failed init must not also surface as an unhandled rejection.
    this.ready.promise.catch(() => undefined);
  }

  /**
   * Stores credentials from the old desktop vault that the vault does not have yet; nothing already
   * saved is overwritten. Goes through the credential store so its cache stays accurate.
   */
  async importCredentials(entries: Record<string, StoredCredential>): Promise<void> {
    let imported = false;
    for (const [id, credential] of Object.entries(entries)) {
      await this.credentials.modify(id, async (current) => {
        if (current !== undefined) return undefined;
        imported = true;
        return credential as Credential;
      });
    }
    if (imported) this.changed(["providers", "models"], { model: true });
  }

  async init(paths: AgentPaths, systemLocale: string): Promise<void> {
    try {
      configureResourcesDir(paths.resourcesDir);
      // Pi's built-in extensions (MCP config, MCP OAuth tokens, logs) resolve the agent directory
      // from this variable rather than the session options; point them at the app's folder.
      process.env.PI_CODING_AGENT_DIR = paths.agentDir;
      const skillsDir = join(paths.agentDir, "skills");
      for (const dir of [paths.workspaceDir, paths.agentDir, paths.sessionDir, skillsDir])
        mkdirSync(dir, { recursive: true });
      // The library resolves its folder, so it is created after the folder exists.
      const skills = new SkillLibrary(skillsDir);
      // Copy the skills that ship with the app (OfficeCLI's), leaving anything the person edited.
      const builtIn = await seedBuiltInSkills(
        resourcePath("skills"),
        skillsDir,
        join(paths.agentDir, "builtin-skills.json"),
      ).catch((error: unknown) => {
        emit({ type: "error", message: errorMessage(error) });
        return new Set<string>();
      });
      for (const name of builtIn) skills.builtIn.add(name);
      const settings = new SettingsStore(paths.settingsFile);
      configureLanguage(settings.get().language, systemLocale);
      const runtime = await ModelRuntime.create({
        credentials: this.credentials,
        modelsPath: null,
        refreshOnCreate: false,
      });
      this.mcpAuth = await VaultMcpAuthStore.open(this.credentials, paths.agentDir);
      const mcpConfig = new McpConfigFile(join(paths.agentDir, "mcp.json"));
      const services: Services = {
        paths,
        runtime,
        settings,
        skills,
        webSearch: new WebSearchService(settings, this.credentials),
        mcpConfig,
        voice: new VoiceService(runtime, settings, join(dirname(paths.settingsFile), "models")),
        memory: new MemoryStore(join(dirname(paths.settingsFile), "memory.json")),
        chatSessions: new ChatSessionMap(join(dirname(paths.settingsFile), "channels.json")),
        mcpServers: new McpRegistrations(mcpConfig, (name) => {
          const { mcpServers } = this.currentAgent();
          return mcpServers === null || mcpServers.includes(name);
        }),
      };
      this.services = services;
      try {
        this.gatewayIds = await syncGateways(runtime, settings.get().gateways, new Set());
      } catch (error) {
        // Registration happened; only reading saved sign-ins failed.
        this.gatewayIds = new Set(settings.get().gateways.map((gateway) => gateway.id));
        emit({
          type: "error",
          message: t("app.signInsUnreadable", { error: errorMessage(error) }),
        });
      }
      await this.startSession(this.newSessionManager());
      this.telegram = new TelegramService({
        dataDir: paths.agentDir,
        settings,
        credentials: this.credentials,
        gateway: this.gateway,
        changed: () => emit({ type: "settings_changed", scopes: ["background"] }),
        t: (key, vars) => t(key, vars),
      });
      this.ready.resolve(services);
      emit({ type: "snapshot", snapshot: this.snapshot() });
      this.startScheduler();
      if (settings.get().channels.telegram.enabled)
        this.telegram
          .start()
          .then(() => this.redeliverPending())
          .catch((error: unknown) => emit({ type: "error", message: errorMessage(error) }));
    } catch (error) {
      this.ready.reject(error);
      throw error;
    }
  }

  /**
   * Stops everything the host started: the Telegram bot, the scheduler, running scheduled tasks,
   * chat sessions, and the open conversation. The process may exit afterwards.
   */
  async dispose(): Promise<void> {
    await this.telegram?.stop().catch((error: unknown) => console.error(error));
    this.scheduler?.stop();
    for (const session of this.taskSessions.values()) void session.abort().catch(() => undefined);
    for (const chat of this.chats.values()) {
      chat.stopped = true;
      this.denyChatApprovals(chat);
    }
    await Promise.allSettled([...this.chats.values()].map((chat) => chat.session.abort()));
    for (const chatKey of [...this.chats.keys()]) this.closeChat(chatKey);
    await this.abort().catch(() => undefined);
    this.disposeSession();
  }

  async handle(command: AgentCommand): Promise<unknown> {
    if (command.type === "get_snapshot") return this.snapshot();
    const services = await this.ready.promise;
    switch (command.type) {
      case "prompt":
        return this.prompt(command.text, command.attachments);
      case "abort":
        return this.abort();
      case "new_chat":
        return this.openSession(null, command.workspaceId ?? null);
      case "respond_approval":
        return this.resolveApproval(command.requestId, command.approved);
      case "respond_question":
        return this.resolveQuestion(command.requestId, command.answers);
      case "list_sessions":
        return this.listSessions();
      case "compact":
        return this.compact();
      case "open_session":
        return this.openSession(this.requireSessionPath(command.path));
      case "rename_session":
        return this.renameSession(this.requireSessionPath(command.path), command.name);
      case "delete_session":
        return this.deleteSession(this.requireSessionPath(command.path));
      case "pin_session":
        return this.pinSession(this.requireSessionPath(command.path), command.pinned);
      case "search_sessions":
        return this.searchSessions(command.query);
      case "export_session":
        return this.exportSession(this.requireSessionPath(command.path), command.format);
      case "get_usage":
        return this.usage();
      case "regenerate":
        return this.regenerate();
      case "edit_message":
        return this.editMessage(command);
      case "branch_session":
        return this.branchSession(command.entryId);

      case "get_settings":
        return appSettings(services.settings);
      case "update_settings":
        return this.updateSettings(command.patch);

      case "list_providers":
        return listProviders(services.runtime, this.gatewayIds);
      case "connect_provider":
        return this.connectProvider(command.providerId);
      case "disconnect_provider":
        return this.disconnectProvider(command.providerId);
      case "respond_auth_prompt":
        return this.prompts.respond(command.promptId, command.value);
      case "list_gateways":
        return Promise.all(
          services.settings.get().gateways.map((gateway) => this.gatewayView(gateway)),
        );
      case "save_gateway":
        return this.saveGateway(command.gateway);
      case "delete_gateway":
        return this.deleteGateway(command.id);
      case "fetch_gateway_models":
        return this.fetchModels(command.api, command.baseUrl, command.apiKey, command.gatewayId);
      case "list_models":
        return availableModels(services.runtime, this.gatewayIds);
      case "set_model":
        return this.setModel({ provider: command.provider, modelId: command.modelId });

      case "list_web_search":
        return services.webSearch.view();
      case "save_web_search":
        return services.webSearch.save(command.config);
      case "test_web_search":
        return services.webSearch.test(command.provider);
      case "list_tools":
        return this.listTools();
      case "set_tool_policy":
        return this.setToolPolicy(command.name, command.policy);

      case "list_skills":
        return services.skills.list(services.settings.get().disabledSkills);
      case "get_skill":
        return services.skills.get(command.name, services.settings.get().disabledSkills);
      case "save_skill":
        return this.saveSkill(command.skill);
      case "delete_skill":
        return this.deleteSkill(command.name);
      case "set_skill_enabled":
        return this.setSkillEnabled(command.name, command.enabled);
      case "import_skill":
        return this.importSkill(command.path);

      case "list_mcp_servers":
        return buildOverview(
          services.mcpConfig,
          await this.mcpStatus(),
          services.mcpServers,
          this.currentAgent().name,
          this.mcpAuth ? "encrypted" : "file",
        );
      case "save_mcp_server":
        return this.saveMcpServer(command.originalName, command.server);
      case "delete_mcp_server":
        services.mcpConfig.deleteServer(command.name);
        return this.changed(["mcp"], { mcp: true });
      case "reconnect_mcp_server":
        this.requireUsedServer(command.name);
        await this.mcp.reconnect(this.requireSession(), command.name);
        return this.changed(["mcp", "tools"], {});
      case "mcp_sign_in":
        this.requireUsedServer(command.name);
        await this.mcp.signIn(this.requireSession(), command.name);
        return this.changed(["mcp", "tools"], {});
      case "mcp_sign_out":
        this.requireUsedServer(command.name);
        await this.mcp.signOut(this.requireSession(), command.name);
        await this.mcpAuth?.flush();
        return this.changed(["mcp", "tools"], {});
      case "get_mcp_json":
        return services.mcpConfig.readText();
      case "save_mcp_json":
        services.mcpConfig.saveText(command.text);
        return this.changed(["mcp"], { mcp: true });

      case "list_agents":
        return sortAgents(services.settings.get().agents);
      case "list_agent_tool_options":
        return agentToolOptions(services.settings.get());
      case "save_agent":
        return this.saveAgent(command.agent);
      case "delete_agent":
        return this.deleteAgent(command.id);
      case "set_agent":
        return this.setAgent(command.id);
      case "set_thinking_level":
        return this.setThinkingLevel(command.level);
      case "export_agent":
        return exportAgent(this.requireAgent(command.id));
      case "import_agent":
        return this.importAgent(command.json);

      case "list_workspaces":
        return sortWorkspaces(services.settings.get().workspaces);
      case "save_workspace":
        return this.saveWorkspace(command.workspace);
      case "delete_workspace":
        return this.deleteWorkspace(command.id);

      case "get_memory":
        return services.memory.view();
      case "set_memory_enabled":
        return this.setMemoryEnabled(command.enabled);
      case "save_memory_entry":
        return this.saveMemoryEntry(
          command.id,
          command.text,
          command.tag ?? null,
          command.workspaceId,
        );
      case "delete_memory_entry":
        return this.deleteMemoryEntry(command.id);
      case "clear_memory":
        return this.clearMemory();

      case "list_scheduled_tasks":
        return this.listScheduledTasks();
      case "save_scheduled_task":
        return this.saveScheduledTask(command.task);
      case "delete_scheduled_task":
        return this.deleteScheduledTask(command.id);
      case "set_scheduled_task_enabled":
        return this.setScheduledTaskEnabled(command.id, command.enabled);
      case "run_scheduled_task":
        return this.runScheduledTaskNow(command.id);

      case "get_voice":
        return services.voice.view();
      case "save_voice":
        return this.saveVoice(command.config);
      case "install_voice_model":
        return this.requireServices().voice.installModel(command.model);
      case "transcribe_audio":
        return {
          text: await services.voice.transcribe(command.data, command.mimeType, command.durationMs),
        };

      case "get_service_status":
        return this.service.status();
      case "set_service_installed":
        return this.setServiceInstalled(command.installed);

      case "get_telegram_status":
        return this.requireTelegram().status();
      case "save_telegram":
        return this.requireTelegram().save(command.config);
      case "start_telegram_pairing":
        return this.requireTelegram().startPairing();
      case "forget_telegram":
        return this.requireTelegram().forget();

      default: {
        const unknown: never = command;
        throw new Error(t("app.unknownCommand", { command: JSON.stringify(unknown) }));
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Conversation
  // -------------------------------------------------------------------------------------------

  private snapshot(): AgentSnapshot {
    return {
      status: this.status,
      messages: this.transcript.list(),
      approvals: [...this.approvals.values()].map((entry) => entry.request),
      questions: [...this.questions.values()].map((entry) => entry.request),
      model: this.currentModel(),
      agent: this.services ? summarizeAgent(this.currentAgent()) : null,
      thinking: this.thinking(),
      workspace: this.services ? summarizeWorkspace(this.currentWorkspace()) : null,
      workspaceDir: this.session?.sessionManager.getCwd() ?? null,
      sessionPath: this.session?.sessionFile ?? null,
      context: this.contextUsage(),
    };
  }
  /** Context window usage of the open conversation, null while it has no model. */
  private contextUsage(): ContextUsage | null {
    const usage = this.session?.getContextUsage();
    return usage ? { tokens: usage.tokens, window: usage.contextWindow } : null;
  }

  /** Agent of the open conversation (the default agent when its agent was deleted). */
  private currentAgent(): AgentProfile {
    return findAgent(this.services?.settings.get().agents ?? [], this.agentId);
  }

  /** Workspace of the open conversation (the default workspace when it was deleted). */
  private currentWorkspace(): WorkspaceProfile {
    return findWorkspace(this.services?.settings.get().workspaces ?? [], this.workspaceId);
  }

  /** Model of the open conversation, when it is still usable. */
  private currentModel(): ModelSummary | null {
    const model = this.session?.model;
    const runtime = this.services?.runtime;
    if (!model || !runtime) return null;
    return findAvailable(runtime, { provider: model.provider, modelId: model.id })
      ? summarizeModel(runtime, model)
      : null;
  }

  private async prompt(text: string, attachments: Attachment[]): Promise<void> {
    const session = this.requireSession();
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    if (!this.currentModel()) throw new Error(t("models.noneChosen"));
    // Copy files and encode images before acknowledging, so a bad attachment fails the send.
    const message = await buildPrompt(
      trimmed || ATTACHMENTS_ONLY_PROMPT,
      attachments,
      session.sessionManager.getCwd(),
    );
    this.startRun(session, message);
  }

  /** Sends a message to the model without waiting for the run; progress arrives as events. */
  private startRun(session: AgentSession, message: PromptMessage): void {
    // prompt() resolves when the whole run finishes.
    const run = session.prompt(message.text, {
      images: message.images,
      ...(session.isStreaming ? { streamingBehavior: "followUp" as const } : {}),
    });
    run.catch((error: unknown) => emit({ type: "error", message: errorMessage(error) }));
  }

  private async compact(): Promise<void> {
    const session = this.requireSession();
    if (this.running || session.isStreaming) throw new Error(t("conversations.waitForAnswer"));
    if (session.isCompacting) return;
    const short = t("conversations.tooShort");
    if (session.messages.length === 0) throw new Error(short);
    try {
      await session.compact().catch(async (error: unknown) => {
        if (!NOTHING_TO_COMPACT.test(errorMessage(error))) throw error;
        // Pi keeps the newest 20,000 tokens, which can be the whole chat. The person asked for it,
        // so retry keeping less; the default comes back afterwards for automatic compaction.
        const { settingsManager } = session;
        settingsManager.applyOverrides({ compaction: { keepRecentTokens: MANUAL_KEEP_TOKENS } });
        try {
          await session.compact();
        } finally {
          settingsManager.applyOverrides({ compaction: { keepRecentTokens: DEFAULT_KEEP_TOKENS } });
        }
      });
    } catch (error) {
      // Even with the smaller window the conversation is a single exchange.
      if (NOTHING_TO_COMPACT.test(errorMessage(error))) throw new Error(short);
      throw error;
    }
    emit({ type: "sessions_changed" });
    emit({ type: "context", context: this.contextUsage() });
  }

  private async abort(): Promise<void> {
    // Pending approvals and questions block the run; settle them first or abort() would wait forever.
    this.denyAllApprovals();
    this.skipAllQuestions();
    await this.session?.abort();
  }

  /** Switch to a saved conversation, or to a new one (in `workspaceId`, else the open workspace). */
  private async openSession(path: string | null, workspaceId: string | null = null): Promise<void> {
    await this.abort();
    this.disposeSession();
    await this.startSession(
      path ? this.savedSessionManager(path) : this.newSessionManager(workspaceId),
    );
    this.transcript.load(branchEntries(this.requireSession().sessionManager));
    emit({ type: "snapshot", snapshot: this.snapshot() });
  }

  /**
   * A new conversation in a workspace, with the workspace's agent (else the agent picked last).
   * Kept in memory until the first reply.
   */
  private newSessionManager(workspaceId: string | null = null): SessionManager {
    const { paths, settings } = this.requireServices();
    const { agents, workspaces, activeAgentId } = settings.get();
    const workspace = findWorkspace(workspaces, workspaceId ?? this.workspaceId);
    this.agentId = findAgent(agents, workspace.agentId ?? activeAgentId).id;
    const cwd = this.workspaceFor(workspace);
    // The folder may have fallen back to the default one, so name the workspace it belongs to.
    this.workspaceId = workspaceForCwd(workspaces, cwd, paths.workspaceDir).id;
    const manager = SessionManager.create(cwd, paths.sessionDir);
    manager.appendCustomEntry(AGENT_ENTRY_TYPE, { agentId: this.agentId });
    return manager;
  }

  /**
   * A saved conversation with its own agent, in the workspace its folder belongs to. One whose
   * workspace was deleted continues in the default workspace.
   */
  private savedSessionManager(path: string): SessionManager {
    const { paths, settings } = this.requireServices();
    const { agents, workspaces } = settings.get();
    const manager = SessionManager.open(path, paths.sessionDir);
    this.agentId = findAgent(agents, conversationAgentId(manager)).id;
    const workspace = workspaceForCwd(workspaces, manager.getCwd(), paths.workspaceDir);
    const cwd = this.workspaceFor(workspace);
    // The folder may have fallen back to the default one, so name the workspace it belongs to.
    this.workspaceId = workspaceForCwd(workspaces, cwd, paths.workspaceDir).id;
    return cwd === manager.getCwd() ? manager : SessionManager.open(path, paths.sessionDir, cwd);
  }

  /** The workspace's folder, created when missing; the app's folder when it cannot be. */
  private workspaceFor(workspace: WorkspaceProfile): string {
    const { paths } = this.requireServices();
    if (!workspace.dir) return paths.workspaceDir;
    try {
      mkdirSync(workspace.dir, { recursive: true });
      return workspace.dir;
    } catch (error) {
      emit({
        type: "error",
        message: t("workspaces.folderUnusable", {
          name: workspace.name,
          error: errorMessage(error),
        }),
      });
      return paths.workspaceDir;
    }
  }

  private async listSessions(): Promise<SessionSummary[]> {
    const { paths, settings } = this.requireServices();
    const { workspaces, pinnedSessions } = settings.get();
    const pins = new Set(pinnedSessions);
    // Conversations of every workspace and agent.
    const sessions = await SessionManager.listAll(paths.sessionDir);
    return sessions
      .filter((info) => info.messageCount > 0)
      .sort((a, b) => b.modified.getTime() - a.modified.getTime())
      .map((info) => ({
        path: info.path,
        workspaceId: workspaceForCwd(workspaces, info.cwd, paths.workspaceDir).id,
        title: sessionTitle(info.name, info.firstMessage, this.titleFallbacks()),
        modified: info.modified.getTime(),
        messageCount: info.messageCount,
        pinned: pins.has(pinKey(info.path)),
      }));
  }

  /** Translated titles for conversations that have no name and no text of their own. */
  private titleFallbacks(): Parameters<typeof sessionTitle>[2] {
    return {
      skillTitle: (name) => t("conversations.skillTitle", { name }),
      untitled: t("conversations.untitled"),
    };
  }

  /** Every saved session as the agent sees it, newest first; `currentFile` marks the one running. */
  private async sessionRows(currentFile: string | undefined): Promise<SessionRow[]> {
    const { paths, settings, chatSessions } = this.requireServices();
    const { workspaces, scheduledTasks } = settings.get();
    const chatFiles = new Map(chatSessions.entries().map(([key, file]) => [file, key]));
    const taskFiles = new Set(
      scheduledTasks.flatMap((task) =>
        task.lastRun?.sessionPath ? [task.lastRun.sessionPath] : [],
      ),
    );
    const infos = await SessionManager.listAll(paths.sessionDir);
    return infos
      .filter((info) => info.messageCount > 0)
      .sort((a, b) => b.modified.getTime() - a.modified.getTime())
      .map((info) => {
        // A scheduled run's title starts with the clock, so older runs are found too.
        if (info.name?.startsWith("⏰")) taskFiles.add(info.path);
        const { kind, peer } = classifySession(info.path, chatFiles, taskFiles);
        return {
          id: sessionRef(info.path),
          title: sessionTitle(info.name, info.firstMessage, this.titleFallbacks()),
          kind,
          peer,
          workspaceId: workspaceForCwd(workspaces, info.cwd, paths.workspaceDir).id,
          modified: info.modified.getTime(),
          messageCount: info.messageCount,
          preview: previewOf(info.firstMessage),
          isCurrent: info.path === currentFile,
        };
      });
  }

  /** The messages of the saved session with `id`; only files in the session folder are read. */
  private async sessionHistory(id: string): Promise<HistoryLine[]> {
    const { paths } = this.requireServices();
    const info = (await SessionManager.listAll(paths.sessionDir)).find(
      (candidate) => sessionRef(candidate.path) === id,
    );
    if (!info) return [];
    const manager = SessionManager.open(info.path, paths.sessionDir);
    return historyLines(
      manager.getBranch().flatMap((entry) => (entry.type === "message" ? [entry.message] : [])),
    );
  }

  /** The person's own chat on a channel, when one is paired and on. */
  private homePeer(): PeerRow | null {
    const telegram = this.services?.settings.get().channels.telegram;
    if (!telegram?.enabled || telegram.ownerId === null) return null;
    const name = telegram.ownerName ? ` – ${telegram.ownerName}` : "";
    // A private Telegram chat has the person's user id as its chat id.
    return { id: "home", label: `Telegram${name}`, key: `telegram:${telegram.ownerId}` };
  }

  private peerRows(): PeerRow[] {
    const home = this.homePeer();
    return home ? [home] : [];
  }

  private renameSession(path: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) throw new Error(t("conversations.enterName"));
    if (this.session?.sessionFile === path) this.session.setSessionName(trimmed);
    else
      SessionManager.open(path, this.requireServices().paths.sessionDir).appendSessionInfo(trimmed);
    emit({ type: "sessions_changed" });
  }

  private async deleteSession(path: string): Promise<void> {
    if (this.session?.sessionFile === path) await this.openSession(null);
    await rm(path, { force: true });
    this.setPinned(path, false);
    emit({ type: "sessions_changed" });
  }

  /** Pins are kept by file name in settings.json; deleting a conversation forgets its pin. */
  private setPinned(path: string, pinned: boolean): boolean {
    const { settings } = this.requireServices();
    const key = pinKey(path);
    if (settings.get().pinnedSessions.includes(key) === pinned) return false;
    settings.update((draft) => {
      draft.pinnedSessions = pinned
        ? [...draft.pinnedSessions, key]
        : draft.pinnedSessions.filter((name) => name !== key);
    });
    return true;
  }

  private pinSession(path: string, pinned: boolean): void {
    if (this.setPinned(path, pinned)) emit({ type: "sessions_changed" });
  }

  private searchSessions(query: string): Promise<SessionSearchHit[]> {
    const { paths, settings } = this.requireServices();
    const { workspaces } = settings.get();
    return searchSessions(
      paths.sessionDir,
      query,
      (cwd) => workspaceForCwd(workspaces, cwd, paths.workspaceDir).id,
      this.titleFallbacks(),
    );
  }

  /** A saved conversation as a Markdown or HTML document, in the app's language. */
  private exportSession(path: string, format: "md" | "html"): SessionExport {
    const { paths, settings } = this.requireServices();
    const manager = SessionManager.open(path, paths.sessionDir);
    const messages = new Transcript(() => {});
    messages.load(branchEntries(manager));
    const firstUser = manager
      .getBranch()
      .find((entry) => entry.type === "message" && entry.message.role === "user");
    const title = sessionTitle(
      manager.getSessionName(),
      firstUser?.type === "message" ? userContent(firstUser.message).text : "",
      this.titleFallbacks(),
    );
    const source = {
      title,
      workspaceName: workspaceForCwd(
        settings.get().workspaces,
        manager.getCwd(),
        paths.workspaceDir,
      ).name,
      date: new Date().toLocaleDateString("sv-SE"), // yyyy-mm-dd in local time
      messages: messages.list(),
    };
    const labels = {
      user: t("conversations.export.you"),
      assistant: t("conversations.export.assistant"),
      image: t("conversations.export.image"),
      skill: (name: string) => t("conversations.export.skill", { name }),
      attachment: (name: string) => t("conversations.export.attachment", { name }),
      tool: (name: string, target: string) =>
        target
          ? t("conversations.export.toolOn", { name, target })
          : t("conversations.export.tool", { name }),
      exportedOn: (date: string) => t("conversations.export.exportedOn", { date }),
      workspace: (name: string) => t("conversations.export.workspace", { name }),
    };
    return {
      suggestedName: exportFileName(title),
      content:
        format === "md"
          ? conversationToMarkdown(source, labels)
          : conversationToHtml(source, labels, currentLanguage()),
    };
  }

  /** Tokens and estimated cost over every reply of the open conversation, as billed. */
  private usage(): SessionUsage {
    const entries = this.session?.sessionManager.getEntries() ?? [];
    return summarizeUsage(
      entries.flatMap((entry) => (entry.type === "message" ? [entry.message] : [])),
    );
  }

  // -------------------------------------------------------------------------------------------
  // Message actions
  // -------------------------------------------------------------------------------------------

  private idleSession(): AgentSession {
    const session = this.requireSession();
    if (this.running || session.isStreaming || session.isCompacting)
      throw new Error(t("conversations.waitForAnswer"));
    return session;
  }

  /** The user message of `entryId` on the open conversation's branch. */
  private userEntry(session: AgentSession, entryId: string) {
    const manager = session.sessionManager;
    const entry = manager.getEntry(entryId);
    if (!entry || !chatEntryIds(manager).includes(entryId))
      throw new Error(t("conversations.messageNotFound"));
    if (entry.type !== "message" || entry.message.role !== "user")
      throw new Error(t("conversations.notEditable"));
    return entry.message;
  }

  /**
   * Continues from the entry before a user message, dropping it and everything after it (they stay
   * in the file as another branch), and sends `message` in its place.
   */
  private async resend(session: AgentSession, entryId: string, message: PromptMessage) {
    if (!this.currentModel()) throw new Error(t("models.noneChosen"));
    const manager = session.sessionManager;
    if (manager.getLeafId() === entryId) {
      // Pi does not move off the entry it is on, which is the case for a message nobody answered.
      const parent = manager.getEntry(entryId)?.parentId ?? null;
      if (parent === null) manager.resetLeaf();
      else manager.branch(parent);
      session.agent.state.messages = manager.buildSessionProjection().messages;
    } else {
      await session.navigateTree(entryId);
    }
    this.transcript.load(branchEntries(manager));
    emit({ type: "snapshot", snapshot: this.snapshot() });
    this.startRun(session, message);
  }

  /** Asks again for the last answer: the last user message is sent anew from where it was. */
  private async regenerate(): Promise<void> {
    const session = this.idleSession();
    const branch = session.sessionManager.getBranch();
    const lastUser = branch.findLastIndex(
      (entry) => entry.type === "message" && entry.message.role === "user",
    );
    const user = branch[lastUser];
    const answered = branch
      .slice(lastUser + 1)
      .some((entry) => entry.type === "message" && entry.message.role === "assistant");
    if (!user || user.type !== "message" || !answered)
      throw new Error(t("conversations.noAnswerToRedo"));
    const { text, images } = userContent(user.message);
    await this.resend(session, user.id, { text, images });
  }

  private async editMessage(params: {
    entryId: string;
    text: string;
    attachments: Attachment[];
    keep: { files: string[]; images: number[] };
  }): Promise<void> {
    const session = this.idleSession();
    const original = userContent(this.userEntry(session, params.entryId));
    const skill = parseSkillBlock(original.text);
    const oldFiles = splitAttachedFiles(skill ? (skill.userMessage ?? "") : original.text).files;
    const keptFiles = oldFiles
      .map((file) => file.path)
      .filter((path) => params.keep.files.includes(path));
    const keptImages = original.images.filter((_, index) => params.keep.images.includes(index));

    const typed = params.text.trim();
    const hasAttachments = keptFiles.length + keptImages.length + params.attachments.length > 0;
    if (!typed && !skill && !hasAttachments) return;
    // A skill stays invoked: pi expands the command again.
    const base = skill
      ? `/skill:${skill.name}${typed ? ` ${typed}` : ""}`
      : typed || ATTACHMENTS_ONLY_PROMPT;
    // Files and images are prepared before anything is dropped, so a bad attachment fails the edit.
    const added = await buildPrompt(base, params.attachments, session.sessionManager.getCwd());
    const addedFiles = splitAttachedFiles(added.text).files.map((file) => file.path);
    await this.resend(session, params.entryId, {
      text: withAttachedFiles(base, [...keptFiles, ...addedFiles]),
      images: [...keptImages, ...added.images],
    });
  }

  /** Starts a new conversation with the chat up to and including a message, and opens it. */
  private async branchSession(entryId: string): Promise<void> {
    const session = this.idleSession();
    const { paths } = this.requireServices();
    const file = session.sessionFile;
    const manager = session.sessionManager;
    if (!file || !existsSync(file)) throw new Error(t("conversations.cannotBranch"));
    if (!chatEntryIds(manager).includes(entryId))
      throw new Error(t("conversations.messageNotFound"));
    // A second manager over the same file: branching rewrites the manager it is called on.
    const fork = SessionManager.open(file, paths.sessionDir);
    const forked = fork.createBranchedSession(endOfTurnEntry(fork, entryId));
    if (!forked) throw new Error(t("conversations.cannotBranch"));
    const first = fork
      .getBranch()
      .find((entry) => entry.type === "message" && entry.message.role === "user");
    const title = sessionTitle(
      manager.getSessionName(),
      first?.type === "message" ? userContent(first.message).text : "",
      this.titleFallbacks(),
    );
    fork.appendSessionInfo(t("conversations.branchTitle", { title }));
    await this.openSession(forked);
  }

  /**
   * Model for a conversation: `preferred` (a saved chat's own model) when still usable, else the
   * agent's model, else the default model, else the first available one.
   */
  private chooseModel(
    preferred: ModelRef | null,
    scope: SessionScope = this.liveScope(),
  ): Model<Api> | undefined {
    const { runtime, settings } = this.requireServices();
    const first = [...runtime.getAvailableSnapshot()].sort((a, b) => {
      const providerA = runtime.getProvider(a.provider)?.name ?? a.provider;
      const providerB = runtime.getProvider(b.provider)?.name ?? b.provider;
      return providerA.localeCompare(providerB) || a.name.localeCompare(b.name);
    })[0];
    return (
      findAvailable(runtime, preferred) ??
      findAvailable(runtime, scope.agent().model) ??
      findAvailable(runtime, settings.get().defaultModel) ??
      first
    );
  }

  /** The open conversation's agent, workspace, MCP servers, and approval gate. */
  private liveScope(): SessionScope {
    return {
      agent: () => this.currentAgent(),
      workspace: () => this.currentWorkspace(),
      mcpServers: this.requireServices().mcpServers,
      approvalGate: this.approvalGate,
      askUser: (call, signal) => this.requestQuestion(call, signal),
      surface: { kind: "window", label: "in the desktop window" },
      visibility: "all",
    };
  }

  /**
   * Builds a Pi session for `sessionManager` (its cwd is the workspace) from the same pieces for
   * the open conversation and for headless scheduled runs: the resource loader with its
   * extensions, skills filtered by the agent, model choice, tools, and bound extensions. It does
   * not touch the host's open conversation. `uiContext` wraps pi's UI context (live session only).
   */
  private async buildSession(
    sessionManager: SessionManager,
    preferredModel: ModelRef | null,
    scope: SessionScope,
    uiContext?: (base: ExtensionUIContext) => ExtensionUIContext,
  ): Promise<AgentSession> {
    const { paths, runtime, settings, skills, webSearch, memory } = this.requireServices();
    const cwd = sessionManager.getCwd();
    // Tools the delegate_task helper can use as well.
    const appTools = [
      currentDateTimeTool,
      createReadDocumentTool(cwd),
      createWebSearchTool(webSearch),
      createWebFetchTool(),
      ...createOfficeTools({
        workspaceDir: cwd,
        homeDir: join(paths.agentDir, "officecli"),
      }),
    ];
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: true, maxRetries: 2 },
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: paths.agentDir,
      settingsManager,
      // Only our own extensions run; skills come from <agentDir>/skills and MCP servers from
      // <agentDir>/mcp.json (registered by the agent extension), both managed in Settings.
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
      extensionFactories: [
        { name: "approval-gate", factory: scope.approvalGate },
        { name: "pp-agent", factory: this.agentExtensionFor(scope, sessionManager) },
        createCodemodeExtension(),
        createToolSearchExtension(),
        // Pi's own mcp.json loading is off: the agent extension registers the agent's servers.
        createMcpExtension({
          loadConfig: () => ({ servers: [], errors: [] }),
          openUrl,
          ...(this.mcpAuth ? { credentials: this.mcpAuth.asPiStore() } : {}),
        }),
      ],
      // Read on every reload, so enabling or disabling a skill applies with `session.reload()`.
      skillsOverride: (base) => {
        const disabled = settings.get().disabledSkills;
        const allowed = scope.agent().skills;
        return {
          skills: base.skills.filter(
            (skill) =>
              skills.owns(skill.baseDir) &&
              !disabled.includes(skill.name) &&
              (allowed === null || allowed.includes(skill.name)),
          ),
          diagnostics: base.diagnostics,
        };
      },
      systemPrompt: SYSTEM_PROMPT,
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd,
      agentDir: paths.agentDir,
      modelRuntime: runtime,
      model: this.chooseModel(preferredModel, scope),
      // A saved conversation keeps its own level (pi restores it); a new one uses the last pick.
      thinkingLevel:
        sessionManager.buildSessionContext().messages.length > 0
          ? undefined
          : settings.get().thinkingLevel,
      tools: toolSelection(settings.get(), scope.agent().tools),
      customTools: [
        ...appTools,
        ...createMemoryTools({
          store: memory,
          isEnabled: () => memory.enabled && scope.agent().memory,
          workspaceId: () => scope.workspace().id,
          onChanged: () => emit({ type: "settings_changed", scopes: ["memory"] }),
        }),
        createTodoTool(),
        ...(scope.askUser ? [createAskTool(scope.askUser)] : []),
        // Like ask_user, only where a person is present: a scheduled run cannot create tasks.
        ...(scope.askUser ? [createScheduleTool(this.scheduleHost(scope, sessionManager))] : []),
        createSessionsTool({
          list: () => this.sessionRows(sessionManager.getSessionFile()),
          history: (id) => this.sessionHistory(id),
          currentId: () => {
            const file = sessionManager.getSessionFile();
            return file ? sessionRef(file) : null;
          },
          peers: () => (scope.visibility === "all" ? this.peerRows() : []),
          visibility: () => scope.visibility,
          locale: () => currentLanguage(),
        }),
        createDelegateTool({
          runtime,
          cwd,
          agentDir: paths.agentDir,
          customTools: appTools,
          allowedTools: () => helperTools(settings.get(), scope.agent().tools),
        }),
      ],
      resourceLoader,
      settingsManager,
      sessionManager,
    });
    // Emits session_start, which connects the MCP servers in the background. The UI context lets
    // Settings drive pi's `/mcp` command (status, reconnect, sign-in).
    await session.bindExtensions({
      ...(uiContext ? { uiContext: uiContext(session.extensionRunner.getUIContext()) } : {}),
      mode: "rpc",
      onError: (error) => emit({ type: "error", message: `${error.event}: ${error.error}` }),
    });
    this.applyActiveTools(session, scope);
    return session;
  }

  /** Starts the conversation of `sessionManager` (its cwd is the agent's workspace). */
  private async startSession(
    sessionManager: SessionManager,
    preferredModel: ModelRef | null = sessionManager.buildSessionContext().model,
  ): Promise<void> {
    const session = await this.buildSession(
      sessionManager,
      preferredModel,
      this.liveScope(),
      (base) => this.mcp.uiContext(base),
    );
    this.session = session;
    this.unsubscribe = session.subscribe((event) => this.onSessionEvent(event));
    // The new session already reflects every setting.
    this.pending = { ...NO_CHANGES };
    this.refreshStatus();
    this.watchMcp(session);
  }

  private disposeSession(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.services?.mcpServers.detach();
    this.session?.dispose();
    this.session = null;
    this.running = false;
  }

  private onSessionEvent(event: AgentSessionEvent): void {
    switch (event.type) {
      case "compaction_end":
        if (event.result && !event.aborted) this.transcript.addCompaction();
        break;
      case "agent_start":
        this.running = true;
        this.refreshStatus();
        break;
      case "agent_settled":
        this.running = false;
        if (this.session) this.transcript.setEntryIds(chatEntryIds(this.session.sessionManager));
        this.transcript.flush();
        this.refreshStatus();
        emit({ type: "sessions_changed" });
        void this.applyPending();
        break;
      case "message_start":
        if (event.message.role === "user") this.transcript.addUser(event.message);
        else if (event.message.role === "assistant") this.transcript.startAssistant();
        break;
      case "message_update":
        if (event.message.role === "assistant")
          this.transcript.updateAssistant(event.message, false);
        break;
      case "message_end":
        if (event.message.role === "assistant")
          this.transcript.updateAssistant(event.message, true);
        emit({ type: "context", context: this.contextUsage() });
        break;
      case "tool_execution_start":
        this.transcript.setToolStatus(event.toolCallId, "running");
        break;
      case "tool_execution_update": {
        // delegate_task reports the helper's steps while it works; the final summary replaces them.
        if (event.toolName !== DELEGATE_TOOL) break;
        const content: unknown = event.partialResult?.content;
        const text = Array.isArray(content)
          ? content
              .filter((block) => block?.type === "text")
              .map((block) => block.text)
              .join("\n")
          : "";
        if (text) this.transcript.setToolStatus(event.toolCallId, "running", text);
        break;
      }
      case "tool_execution_end": {
        const content: unknown = event.result?.content;
        this.transcript.finishTool(
          event.toolCallId,
          Array.isArray(content) ? content : [],
          event.isError,
        );
        break;
      }
    }
  }

  private refreshStatus(): void {
    if (this.running) this.setStatus("running");
    else this.setStatus(this.currentModel() ? "idle" : "unconfigured");
  }

  private setStatus(status: AgentStatus): void {
    if (this.status === status) return;
    this.status = status;
    emit({ type: "status", status });
  }

  // -------------------------------------------------------------------------------------------
  // Approvals
  // -------------------------------------------------------------------------------------------

  /** Gate of the open conversation: asks the person before tools that need approval. */
  private readonly approvalGate: ExtensionFactory = this.gateFor(
    () => this.currentAgent(),
    (request) => this.requestApproval(request),
  );

  /**
   * Extension that applies tool policies for `agent` and settles tools that need approval through
   * `ask`: the open conversation asks the person, a scheduled run (nobody there) denies.
   */
  private gateFor(
    agent: () => AgentProfile,
    ask: (request: ApprovalRequest) => Promise<boolean>,
    declinedReason = "The user declined this action.",
  ): ExtensionFactory {
    return (pi) => {
      pi.on("tool_call", async (event) => {
        const info = pi.getAllTools().find((tool) => tool.name === event.toolName);
        const tier = toolTier(event.toolName, info?.annotations);
        const settings = this.services?.settings.get();
        if (!settings) return { block: true, reason: "The app is still starting." };
        // Tools that are off stay registered (codemode can reach any registered tool), so the gate
        // blocks them too.
        const rule = toolRule(event.toolName, tier, settings);
        if (rule.effective === "off")
          return { block: true, reason: `${event.toolName} is turned off in Settings.` };
        const profile = agent();
        if (!agentAllowsTool(profile.tools, event.toolName))
          return { block: true, reason: `${event.toolName} is not available to ${profile.name}.` };
        if (rule.effective === "allow") return undefined;
        const approved = await ask({
          requestId: randomUUID(),
          toolCallId: event.toolCallId,
          anchorToolCallId: event.parentToolCallId ?? event.toolCallId,
          toolName: event.toolName,
          tier,
          ...describeToolCall(event.toolName, this.approvalInput(event.toolName, event.input)),
        });
        return approved ? undefined : { block: true, reason: declinedReason };
      });
    };
  }

  /** What the approval card describes: a note to forget is shown by its text, not its id. */
  private approvalInput(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
    if (toolName !== MEMORY_FORGET_TOOL || typeof input.id !== "string") return input;
    const note = this.services?.memory.find(input.id.trim());
    return note ? { ...input, text: note.text } : input;
  }

  /**
   * Extension of a session's agent: connects its MCP servers and adds its rules to the system
   * prompt (read on every prompt, so edits apply from the next message). A scope with a
   * `systemNote` (headless run) adds it as well.
   */
  private agentExtensionFor(scope: SessionScope, sessionManager: SessionManager): ExtensionFactory {
    return (pi) => {
      scope.mcpServers.attach(pi);
      // Old tool output is replaced by a note in what the model reads; the chat keeps showing it.
      pi.on("context", (event) => ({ messages: pruneToolOutputs(event.messages) }));
      pi.on("before_agent_start", (event) => {
        const { sections } = event.systemPromptOptions;
        const agentSection = agentPromptSection(scope.agent());
        if (agentSection) sections.agent = agentSection;
        else delete sections.agent;
        const workspaceSection = workspacePromptSection(scope.workspace());
        if (workspaceSection) sections.workspace = workspaceSection;
        else delete sections.workspace;
        if (scope.systemNote) sections[scope.systemNote.section] = scope.systemNote.text;
        const file = sessionManager.getSessionFile();
        sections.where = sessionContextSection({
          now: new Date(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          sessionId: file ? sessionRef(file) : null,
          kind: scope.surface.kind,
          surface: scope.surface.label,
          home: scope.visibility === "all" ? (this.homePeer()?.label ?? null) : null,
          sessionsTool: pi.getActiveTools().includes(SESSIONS_TOOL),
        });
        const memory = this.services?.memory;
        if (memory && this.memoryOn(scope.agent()))
          sections.memory = memorySection(memory.entriesFor(scope.workspace().id));
        else delete sections.memory;
        const planning = planningSection(pi.getActiveTools());
        if (planning) sections.planning = planning;
        else delete sections.planning;
        const ask = askSection(pi.getActiveTools());
        if (ask) sections.ask = ask;
        else delete sections.ask;
      });
    };
  }

  private requestApproval(request: ApprovalRequest): Promise<boolean> {
    this.transcript.setToolStatus(request.toolCallId, "awaiting-approval");
    emit({ type: "approval_requested", request });
    const { promise, resolve } = Promise.withResolvers<boolean>();
    this.approvals.set(request.requestId, { request, resolve });
    return promise;
  }

  private resolveApproval(requestId: string, approved: boolean): void {
    const entry = this.approvals.get(requestId);
    if (!entry) return;
    this.approvals.delete(requestId);
    this.transcript.setToolStatus(entry.request.toolCallId, approved ? "running" : "denied");
    emit({ type: "approval_resolved", requestId });
    entry.resolve(approved);
  }

  private denyAllApprovals(): void {
    for (const requestId of [...this.approvals.keys()]) this.resolveApproval(requestId, false);
  }

  // -------------------------------------------------------------------------------------------
  // Questions (ask_user)
  // -------------------------------------------------------------------------------------------

  /** Shows the questions in the open conversation; resolves with the answers, or null if skipped. */
  private requestQuestion(
    call: { toolCallId: string; questions: Question[] },
    signal?: AbortSignal,
  ): Promise<QuestionAnswer[] | null> {
    if (signal?.aborted) return Promise.resolve(null);
    const request: QuestionRequest = { requestId: randomUUID(), ...call };
    this.transcript.setToolStatus(request.toolCallId, "awaiting-answer");
    emit({ type: "question_requested", request });
    const { promise, resolve } = Promise.withResolvers<QuestionAnswer[] | null>();
    const onAbort = () => this.resolveQuestion(request.requestId, null);
    signal?.addEventListener("abort", onAbort, { once: true });
    this.questions.set(request.requestId, {
      request,
      resolve: (answers) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(answers);
      },
    });
    return promise;
  }

  /**
   * Settles a question. Answers that do not fit the questions are refused (the command fails and
   * the card stays open); `null` skips them.
   */
  private resolveQuestion(requestId: string, answers: QuestionAnswer[] | null): void {
    const entry = this.questions.get(requestId);
    if (!entry) return;
    const checked = answers === null ? null : checkAnswers(entry.request.questions, answers);
    this.questions.delete(requestId);
    // A skipped question is final, as a denied approval: the error the tool ends with must not replace it.
    this.transcript.setToolStatus(entry.request.toolCallId, checked ? "running" : "denied");
    emit({ type: "question_resolved", requestId });
    entry.resolve(checked);
  }

  private skipAllQuestions(): void {
    for (const requestId of [...this.questions.keys()]) this.resolveQuestion(requestId, null);
  }

  // -------------------------------------------------------------------------------------------
  // Live settings
  // -------------------------------------------------------------------------------------------

  /** Tells the renderer what changed and applies it to the conversation (after the run, if any). */
  private changed(scopes: SettingsScope[], apply: Partial<PendingChanges>): void {
    if (scopes.length > 0) emit({ type: "settings_changed", scopes });
    for (const key of Object.keys(this.pending) as (keyof PendingChanges)[])
      this.pending[key] ||= apply[key] === true;
    if (!this.running) void this.applyPending();
  }

  private applyPending(): Promise<void> {
    this.applying = this.applying.then(async () => {
      const session = this.session;
      if (this.running || !session) return;
      const changes = this.pending;
      if (!Object.values(changes).some(Boolean)) return;
      this.pending = { ...NO_CHANGES };
      try {
        let current = session;
        const moved =
          changes.workspace &&
          this.workspaceFor(this.currentWorkspace()) !== session.sessionManager.getCwd();
        if (moved) {
          // The new session reflects every setting already.
          current = await this.moveToWorkspace(session);
        } else {
          // A reload loads the extensions again, which registers the MCP servers anew.
          if (changes.reload) await session.reload();
          else if (changes.mcp) this.requireServices().mcpServers.sync();
          if (this.session !== session) return;
          if (changes.reload || changes.tools) this.applyActiveTools(session);
          if (changes.reload || changes.mcp) this.watchMcp(session);
        }
        if (changes.model) await this.ensureModel(current);
        if (changes.agentModel) await this.useAgentModel(current);
        this.refreshStatus();
        emit({ type: "snapshot", snapshot: this.snapshot() });
        // MCP servers (re)connected, so their state is refetched along with the tools.
        if (moved || changes.reload || changes.mcp)
          emit({ type: "settings_changed", scopes: ["tools", "mcp"] });
        else if (changes.tools) emit({ type: "settings_changed", scopes: ["tools"] });
      } catch (error) {
        emit({
          type: "error",
          message: t("app.settingsNotApplied", { error: errorMessage(error) }),
        });
      }
    });
    return this.applying;
  }

  /**
   * Reopens the conversation in its agent's workspace, keeping the transcript and model. A
   * conversation that has not been saved yet (no reply so far) starts over in the new folder.
   */
  private async moveToWorkspace(session: AgentSession): Promise<AgentSession> {
    const { paths } = this.requireServices();
    const cwd = this.workspaceFor(this.currentWorkspace());
    const file = session.sessionFile;
    const model = session.model
      ? { provider: session.model.provider, modelId: session.model.id }
      : null;
    this.disposeSession();
    let manager: SessionManager;
    if (file && existsSync(file)) {
      manager = SessionManager.open(file, paths.sessionDir, cwd);
    } else {
      manager = SessionManager.create(cwd, paths.sessionDir);
      manager.appendCustomEntry(AGENT_ENTRY_TYPE, { agentId: this.agentId });
    }
    await this.startSession(manager, model);
    const next = this.requireSession();
    this.transcript.load(branchEntries(next.sessionManager));
    return next;
  }

  private applyActiveTools(session: AgentSession, scope: SessionScope = this.liveScope()): void {
    const current = session.getActiveToolNames();
    const agent = scope.agent();
    const allActive = activeToolsFor(current, this.requireServices().settings.get(), agent.tools);
    // Without memory (Settings › Memory or the agent's own switch) the memory tools are not offered.
    const withMemory = this.memoryOn(agent)
      ? allActive
      : allActive.filter((name) => !MEMORY_TOOLS.includes(name));
    // Where nobody can answer (a scheduled run), ask_user and schedule_task are not registered, so
    // they cannot be active.
    const next = scope.askUser
      ? withMemory
      : withMemory.filter((name) => name !== ASK_TOOL && name !== SCHEDULE_TOOL);
    // Only touch the loadout when it changes: replacing it drops MCP tools still connecting.
    const same = next.length === current.length && next.every((name) => current.includes(name));
    if (!same) session.setActiveToolsByName(next);
  }

  /** Keeps a usable model on the conversation after providers or gateways changed. */
  private async ensureModel(session: AgentSession): Promise<void> {
    const { runtime } = this.requireServices();
    await runtime.getAvailable();
    const current = session.model;
    const fresh =
      current && findAvailable(runtime, { provider: current.provider, modelId: current.id });
    if (fresh) {
      // A re-registered gateway has new model objects (its settings may have changed).
      if (fresh !== current && this.gatewayIds.has(fresh.provider)) await session.setModel(fresh);
      return;
    }
    const fallback = this.chooseModel(null);
    if (fallback) await session.setModel(fallback);
  }

  /** Switches the conversation to its agent's own model, when the agent has one. */
  private async useAgentModel(session: AgentSession): Promise<void> {
    const ref = this.currentAgent().model;
    if (!ref) return;
    const { runtime } = this.requireServices();
    let model = findAvailable(runtime, ref);
    if (!model) {
      await runtime.getAvailable();
      model = findAvailable(runtime, ref);
    }
    const current = session.model;
    if (!model) {
      emit({
        type: "error",
        message: t("models.notAvailableKeeping", {
          model: ref.modelId,
          current: current?.name ?? t("models.currentModel"),
        }),
      });
      return;
    }
    if (current?.provider !== model.provider || current.id !== model.id)
      await session.setModel(model);
  }

  /** Once the MCP servers finish connecting, the renderer refetches their state and tools. */
  private watchMcp(session: AgentSession): void {
    if (!this.requireServices().mcpServers.hasServers()) return;
    this.mcp.status(session).then(
      () => {
        if (this.session === session) emit({ type: "settings_changed", scopes: ["mcp", "tools"] });
      },
      () => undefined,
    );
  }

  private async mcpStatus(): Promise<string | null> {
    if (!this.session) return null;
    try {
      return await this.mcp.status(this.session);
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Settings, providers, gateways
  // -------------------------------------------------------------------------------------------

  private async updateSettings(patch: SettingsPatch): Promise<AppSettings> {
    const { runtime, settings } = this.requireServices();
    const scopes: SettingsScope[] = ["settings"];
    const apply: Partial<PendingChanges> = {};
    const before = settings.get();
    if (patch.defaultModel) {
      await runtime.getAvailable();
      if (!findAvailable(runtime, patch.defaultModel)) {
        const gateway = gatewayNeedingKey(runtime, this.gatewayIds, patch.defaultModel);
        throw new Error(
          gateway
            ? t("models.gatewayNeedsKey", { name: gateway })
            : t("models.notAvailableConnect"),
        );
      }
    }
    if (patch.shortcut !== undefined && !isValidAccelerator(patch.shortcut))
      throw new Error(t("settings.shortcutInvalid"));
    const after = settings.update((draft) => {
      if (patch.defaultModel !== undefined) draft.defaultModel = patch.defaultModel;
      if (typeof patch.shellEnabled === "boolean") draft.shellEnabled = patch.shellEnabled;
      if (patch.language !== undefined) draft.language = patch.language;
      if (typeof patch.notifications === "boolean") draft.notifications = patch.notifications;
      if (typeof patch.tray === "boolean") draft.tray = patch.tray;
      if (typeof patch.shortcutEnabled === "boolean") draft.shortcutEnabled = patch.shortcutEnabled;
      if (patch.shortcut !== undefined) draft.shortcut = patch.shortcut;
    });
    if (after.language !== before.language) {
      configureLanguage(after.language);
      // Provider sign-in sources and untitled-chat names are worded by the agent process.
      scopes.push("providers", "sessions");
    }
    if (after.shellEnabled !== before.shellEnabled) {
      scopes.push("tools");
      apply.tools = true;
    }
    // A conversation that has not started yet follows the new default model, unless its agent
    // brings its own.
    const session = this.session;
    if (
      patch.defaultModel &&
      session &&
      !this.running &&
      session.messages.length === 0 &&
      !findAvailable(runtime, this.currentAgent().model)
    ) {
      const model = findAvailable(runtime, patch.defaultModel);
      if (model) {
        await session.setModel(model);
        this.refreshStatus();
        emit({ type: "snapshot", snapshot: this.snapshot() });
      }
    }
    this.changed(scopes, apply);
    return appSettings(settings);
  }

  private async connectProvider(providerId: string): Promise<ProviderSummary> {
    const { runtime } = this.requireServices();
    const provider = runtime.getProvider(providerId);
    if (!provider) throw new Error(t("providers.unknown", { id: providerId }));
    try {
      await runtime.login(
        providerId,
        "api_key",
        authInteraction(this.prompts, t("providers.connect", { name: provider.name })),
      );
    } catch (error) {
      // The key was saved; only the local refresh failed, and the next refresh catches up.
      if (!(error instanceof CredentialSynchronizationError)) throw error;
    }
    this.changed(["providers", "models"], { model: true });
    const summary = (await listProviders(runtime, this.gatewayIds)).find(
      (entry) => entry.id === providerId,
    );
    if (!summary) throw new Error(t("providers.unknown", { id: providerId }));
    return summary;
  }

  private async disconnectProvider(providerId: string): Promise<void> {
    try {
      await this.requireServices().runtime.logout(providerId);
    } catch (error) {
      if (!(error instanceof CredentialSynchronizationError)) throw error;
    }
    this.changed(["providers", "models"], { model: true });
  }

  private async storedKey(providerId: string): Promise<string> {
    const credential = await this.credentials.read(providerId);
    return credential?.type === "api_key" ? (credential.key ?? "") : "";
  }

  private async gatewayView(gateway: GatewayConfig): Promise<GatewayView> {
    return { ...gateway, hasApiKey: (await this.storedKey(gateway.id)) !== "" };
  }

  private async saveGateway(input: SaveGatewayInput): Promise<GatewayView> {
    const { runtime, settings } = this.requireServices();
    const name = input.name.trim();
    if (!name) throw new Error(t("gateways.nameRequired"));
    if (!GATEWAY_APIS.includes(input.api))
      throw new Error(t("gateways.unsupportedApi", { api: input.api }));
    const baseUrl = normalizeBaseUrl(input.api, input.baseUrl);
    const models = cleanGatewayModels(input.models);
    if (input.id !== undefined && !settings.get().gateways.some((entry) => entry.id === input.id))
      throw new Error(t("gateways.notFound"));

    let gateway: GatewayConfig | undefined;
    const saved = settings.update((draft) => {
      const id = input.id ?? newGatewayId(name, new Set(draft.gateways.map((entry) => entry.id)));
      gateway = {
        id,
        name,
        api: input.api,
        baseUrl,
        models,
        requiresApiKey: input.requiresApiKey !== false,
      };
      const index = draft.gateways.findIndex((entry) => entry.id === id);
      if (index === -1) draft.gateways.push(gateway);
      else draft.gateways[index] = gateway;
    });
    if (!gateway) throw new Error(t("gateways.notSaved"));
    const { id } = gateway;

    if (input.apiKey !== undefined) {
      const key = input.apiKey.trim();
      if (key) await this.credentials.modify(id, async () => ({ type: "api_key", key }));
      else await this.credentials.delete(id);
    }
    this.gatewayIds = await syncGateways(runtime, saved.gateways, this.gatewayIds);
    this.changed(["providers", "models"], { model: true });
    return this.gatewayView(gateway);
  }

  private async deleteGateway(id: string): Promise<void> {
    const { runtime, settings } = this.requireServices();
    const saved = settings.update((draft) => {
      draft.gateways = draft.gateways.filter((entry) => entry.id !== id);
      if (draft.defaultModel?.provider === id) draft.defaultModel = null;
    });
    await this.credentials.delete(id);
    this.gatewayIds = await syncGateways(runtime, saved.gateways, this.gatewayIds);
    this.changed(["providers", "models", "settings"], { model: true });
  }

  private async fetchModels(
    api: SaveGatewayInput["api"],
    rawBaseUrl: string,
    apiKey: string | undefined,
    gatewayId: string | undefined,
  ): Promise<FetchedGatewayModel[]> {
    const { runtime } = this.requireServices();
    const baseUrl = normalizeBaseUrl(api, rawBaseUrl);
    const key = apiKey?.trim() || (gatewayId ? await this.storedKey(gatewayId) : "");
    return fetchGatewayModels(runtime, api, baseUrl, key);
  }

  private async setModel(ref: ModelRef): Promise<void> {
    const { runtime } = this.requireServices();
    const session = this.requireSession();
    let model = findAvailable(runtime, ref);
    if (!model) {
      await runtime.getAvailable();
      model = findAvailable(runtime, ref);
    }
    if (!model) {
      const gateway = gatewayNeedingKey(runtime, this.gatewayIds, ref);
      throw new Error(
        gateway
          ? t("models.gatewayNeedsKey", { name: gateway })
          : t("models.notAvailableInSettings"),
      );
    }
    await session.setModel(model);
    this.refreshStatus();
    emit({ type: "snapshot", snapshot: this.snapshot() });
  }

  /** Thinking of the open conversation; pi clamps the level to what its model offers. */
  private thinking(): AgentSnapshot["thinking"] {
    const session = this.session;
    if (!session?.model || !session.supportsThinking()) return { level: "off", available: [] };
    return { level: session.thinkingLevel, available: session.getAvailableThinkingLevels() };
  }

  private setThinkingLevel(level: ThinkingLevel): void {
    const { settings } = this.requireServices();
    const session = this.requireSession();
    if (!THINKING_LEVELS.includes(level))
      throw new Error(t("settings.unknownThinkingLevel", { level }));
    session.setThinkingLevel(level);
    if (settings.get().thinkingLevel !== level) {
      settings.update((draft) => {
        draft.thinkingLevel = level;
      });
      this.changed(["settings"], {});
    }
    emit({ type: "snapshot", snapshot: this.snapshot() });
  }

  // -------------------------------------------------------------------------------------------
  // Tools and skills
  // -------------------------------------------------------------------------------------------

  private listTools(): ToolSummary[] {
    const session = this.session;
    if (!session) return [];
    const settings = this.requireServices().settings.get();
    return session
      .getAllTools()
      .filter((tool) => tool.exposure !== "hidden" && isListedTool(tool.name))
      .map((tool) => {
        const tier = toolTier(tool.name, tool.annotations);
        return {
          name: tool.name,
          description: tool.description.split("\n")[0] ?? "",
          source: parseMcpToolName(tool.name)?.server ?? "built-in",
          tier,
          ...toolRule(tool.name, tier, settings),
        };
      })
      .sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
  }

  private setToolPolicy(name: string, policy: ToolPolicy): void {
    const { settings } = this.requireServices();
    if (!TOOL_POLICIES.includes(policy)) throw new Error(t("settings.unknownPolicy", { policy }));
    // The shell asks or runs freely; `auto` and `off` do not apply (turn it off with its switch).
    if (name === SHELL_TOOL && policy !== "ask" && policy !== "allow")
      throw new Error(t("settings.shellPolicy"));
    if (toolRule(name, toolTier(name), settings.get()).locked)
      throw new Error(t("settings.toolLocked"));
    settings.update((draft) => {
      draft.toolPolicies[name] = policy;
    });
    this.changed(["tools"], { tools: true });
  }

  private async saveSkill(input: SaveSkillInput): Promise<SkillSummary> {
    const { settings, skills } = this.requireServices();
    const summary = await skills.save(input, settings.get().disabledSkills);
    const renamedFrom = input.originalName;
    const scopes: SettingsScope[] = ["skills"];
    if (renamedFrom && renamedFrom !== summary.name) {
      const rename = (name: string) => (name === renamedFrom ? summary.name : name);
      settings.update((draft) => {
        draft.disabledSkills = draft.disabledSkills.map(rename);
        for (const agent of draft.agents) agent.skills = agent.skills?.map(rename) ?? null;
      });
      scopes.push("agents");
    }
    this.changed(scopes, { reload: true });
    return summary;
  }

  private async deleteSkill(name: string): Promise<void> {
    const { settings, skills } = this.requireServices();
    await skills.delete(name);
    if (settings.get().disabledSkills.includes(name)) {
      settings.update((draft) => {
        draft.disabledSkills = draft.disabledSkills.filter((entry) => entry !== name);
      });
    }
    this.changed(["skills"], { reload: true });
  }

  private setSkillEnabled(name: string, enabled: boolean): void {
    this.requireServices().settings.update((draft) => {
      const others = draft.disabledSkills.filter((entry) => entry !== name);
      draft.disabledSkills = enabled ? others : [...others, name];
    });
    this.changed(["skills"], { reload: true });
  }

  private async importSkill(path: string): Promise<SkillSummary[]> {
    const { settings, skills } = this.requireServices();
    const imported = await skills.import(path, settings.get().disabledSkills);
    this.changed(["skills"], { reload: true });
    return imported;
  }

  private saveMcpServer(originalName: string | undefined, server: McpServerSettings): void {
    const { mcpConfig, settings } = this.requireServices();
    mcpConfig.saveServer(originalName, server);
    const name = server.name.trim();
    const scopes: SettingsScope[] = ["mcp"];
    if (originalName !== undefined && originalName !== name) {
      // Agents that use the server keep using it under its new name.
      settings.update((draft) => {
        for (const agent of draft.agents)
          agent.mcpServers =
            agent.mcpServers?.map((entry) => (entry === originalName ? name : entry)) ?? null;
      });
      scopes.push("agents");
    }
    this.changed(scopes, { mcp: true });
  }

  // -------------------------------------------------------------------------------------------
  // Agents
  // -------------------------------------------------------------------------------------------

  private async saveAgent(input: SaveAgentInput): Promise<AgentProfile> {
    const { settings } = this.requireServices();
    const fields = validateAgentInput(input);
    const before = input.id === undefined ? undefined : this.requireAgent(input.id);
    assertUniqueName(settings.get().agents, fields.name, before?.id);
    const saved: AgentProfile = {
      id: before?.id ?? newAgentId(settings.get().agents, fields.name),
      ...fields,
    };
    settings.update((draft) => {
      const index = draft.agents.findIndex((agent) => agent.id === saved.id);
      if (index === -1) draft.agents.push(saved);
      else draft.agents[index] = saved;
    });
    if (before && before.id === this.agentId) {
      this.changed(["agents"], agentChanges(before, saved, false));
      // Its name or icon may have changed.
      emit({ type: "snapshot", snapshot: this.snapshot() });
    } else {
      this.changed(["agents"], {});
    }
    return saved;
  }

  private deleteAgent(id: string): void {
    if (id === DEFAULT_AGENT_ID) throw new Error(t("agents.builtinCannotDelete"));
    const { settings } = this.requireServices();
    const agent = this.requireAgent(id);
    const wasActive = settings.get().activeAgentId === id;
    settings.update((draft) => {
      draft.agents = draft.agents.filter((entry) => entry.id !== id);
      if (draft.activeAgentId === id) draft.activeAgentId = DEFAULT_AGENT_ID;
      // Workspaces that started with it start with the agent picked last instead.
      for (const workspace of draft.workspaces)
        if (workspace.agentId === id) workspace.agentId = null;
    });
    const scopes: SettingsScope[] = wasActive
      ? ["agents", "settings", "workspaces"]
      : ["agents", "workspaces"];
    // Other conversations that used it fall back to the default agent when they are opened.
    if (this.agentId === id)
      this.switchAgent(findAgent(settings.get().agents, DEFAULT_AGENT_ID), scopes, agent);
    else this.changed(scopes, {});
  }

  /** Agent for the open conversation and for new ones. */
  private setAgent(id: string): void {
    const { settings } = this.requireServices();
    const agent = this.requireAgent(id);
    const scopes: SettingsScope[] = [];
    if (settings.get().activeAgentId !== id) {
      settings.update((draft) => {
        draft.activeAgentId = id;
      });
      scopes.push("settings");
    }
    this.switchAgent(agent, scopes, this.currentAgent());
  }

  /**
   * Records `agent` on the open conversation and applies it (after the run, if any): its tools,
   * MCP servers, skills, workspace, and model. `before` is the agent the conversation had.
   */
  private switchAgent(agent: AgentProfile, scopes: SettingsScope[], before: AgentProfile): void {
    if (this.agentId === agent.id) {
      this.changed(scopes, {});
      return;
    }
    this.agentId = agent.id;
    this.requireSession().sessionManager.appendCustomEntry(AGENT_ENTRY_TYPE, {
      agentId: agent.id,
    });
    this.changed(scopes, agentChanges(before, agent, true));
    emit({ type: "snapshot", snapshot: this.snapshot() });
  }

  private importAgent(json: string): AgentProfile {
    const { settings } = this.requireServices();
    const fields = parseAgentExport(json);
    const agents = settings.get().agents;
    const name = uniqueName(agents, fields.name);
    const agent: AgentProfile = {
      ...fields,
      id: newAgentId(agents, name),
      name,
    };
    settings.update((draft) => {
      draft.agents.push(agent);
    });
    this.changed(["agents"], {});
    return agent;
  }

  // -------------------------------------------------------------------------------------------
  // Workspaces
  // -------------------------------------------------------------------------------------------

  private async saveWorkspace(input: SaveWorkspaceInput): Promise<WorkspaceProfile> {
    const { paths, settings } = this.requireServices();
    const fields = validateWorkspaceInput(input);
    const before = input.id === undefined ? undefined : this.requireWorkspace(input.id);
    const { agents, workspaces } = settings.get();
    assertUniqueWorkspaceName(workspaces, fields.name, before?.id);
    if (fields.agentId !== null && !agents.some((agent) => agent.id === fields.agentId))
      throw new Error(t("workspaces.agentMissing"));
    // Conversations belong to a workspace by its folder, so the folder is set once, on creation.
    const dir = before
      ? before.dir
      : await prepareFolder(input.dir, workspaces, paths.workspaceDir);
    const saved: WorkspaceProfile = {
      id: before?.id ?? newWorkspaceId(workspaces, fields.name),
      ...fields,
      dir,
    };
    settings.update((draft) => {
      const index = draft.workspaces.findIndex((workspace) => workspace.id === saved.id);
      if (index === -1) draft.workspaces.push(saved);
      else draft.workspaces[index] = saved;
    });
    this.changed(["workspaces"], {});
    // Its name or icon may have changed.
    if (saved.id === this.workspaceId) emit({ type: "snapshot", snapshot: this.snapshot() });
    emit({ type: "sessions_changed" });
    return saved;
  }

  private deleteWorkspace(id: string): void {
    if (id === DEFAULT_WORKSPACE_ID) throw new Error(t("workspaces.builtinCannotDelete"));
    const { settings } = this.requireServices();
    this.requireWorkspace(id);
    settings.update((draft) => {
      draft.workspaces = draft.workspaces.filter((entry) => entry.id !== id);
    });
    // Its notes are forgotten with it; its conversations stay on disk and show up in the
    // default workspace.
    this.requireServices().memory.removeWorkspace(id);
    const open = this.workspaceId === id;
    if (open) this.workspaceId = DEFAULT_WORKSPACE_ID;
    this.changed(["workspaces", "memory"], { workspace: open });
    emit({ type: "sessions_changed" });
  }

  // -------------------------------------------------------------------------------------------
  // Scheduled tasks
  // -------------------------------------------------------------------------------------------

  private async saveVoice(config: VoiceSettings): Promise<VoiceView> {
    const view = await this.requireServices().voice.save(config);
    emit({ type: "settings_changed", scopes: ["voice"] });
    return view;
  }

  private startScheduler(): void {
    const { settings } = this.requireServices();
    const scheduler = new Scheduler({
      now: () => Date.now(),
      tasks: () => settings.get().scheduledTasks,
      rearm: (id, at) =>
        this.updateTask(id, (task) => {
          task.armedAt = at;
        }),
      run: (task) => this.runScheduledTask(task),
      changed: () => emit({ type: "settings_changed", scopes: ["scheduledTasks"] }),
    });
    this.scheduler = scheduler;
    scheduler.start();
  }

  /** Changes one stored task; false when it no longer exists. */
  private updateTask(id: string, change: (task: ScheduledTask) => void): boolean {
    const { settings } = this.requireServices();
    if (!settings.get().scheduledTasks.some((task) => task.id === id)) return false;
    settings.update((draft) => {
      const task = draft.scheduledTasks.find((entry) => entry.id === id);
      if (task) change(task);
    });
    return true;
  }

  private taskView(task: ScheduledTask): ScheduledTaskView {
    return {
      ...task,
      state: this.scheduler?.state(task.id) ?? "idle",
      nextRun: nextRun(schedulableOf(task), Date.now()),
    };
  }

  private listScheduledTasks(): ScheduledTaskView[] {
    return [...this.requireServices().settings.get().scheduledTasks]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((task) => this.taskView(task));
  }

  private requireTask(id: string): ScheduledTask {
    const task = this.requireServices()
      .settings.get()
      .scheduledTasks.find((entry) => entry.id === id);
    if (!task) throw new Error(t("scheduler.errors.notFound"));
    return task;
  }

  private saveScheduledTask(input: SaveScheduledTaskInput): ScheduledTaskView {
    const { settings } = this.requireServices();
    const existing = settings.get().scheduledTasks;
    const previous = input.id ? this.requireTask(input.id) : undefined;
    const fields = validateTaskInput(input, existing);
    this.requireAgent(fields.agentId);
    this.requireWorkspace(fields.workspaceId);
    const now = Date.now();
    const scheduleChanged = JSON.stringify(previous?.schedule) !== JSON.stringify(fields.schedule);
    // Runs are counted from now when the task is new, switched on, or its schedule changed.
    const rearm = !previous || (!previous.enabled && fields.enabled) || scheduleChanged;
    const id = previous?.id ?? newTaskId(new Set(existing.map((task) => task.id)));
    const task: ScheduledTask = {
      ...fields,
      id,
      armedAt: rearm ? now : (previous?.armedAt ?? now),
      lastRun:
        fields.schedule.kind === "once" && scheduleChanged ? null : (previous?.lastRun ?? null),
    };
    settings.update((draft) => {
      const index = draft.scheduledTasks.findIndex((entry) => entry.id === id);
      if (index >= 0) draft.scheduledTasks[index] = task;
      else draft.scheduledTasks.push(task);
    });
    this.tasksChanged();
    return this.taskView(task);
  }

  private setScheduledTaskEnabled(id: string, enabled: boolean): void {
    const task = this.requireTask(id);
    if (task.enabled === enabled) return;
    this.updateTask(id, (draft) => {
      draft.enabled = enabled;
      if (enabled) draft.armedAt = Date.now();
    });
    this.tasksChanged();
  }

  private deleteScheduledTask(id: string): void {
    this.requireTask(id);
    this.requireServices().settings.update((draft) => {
      draft.scheduledTasks = draft.scheduledTasks.filter((task) => task.id !== id);
    });
    // A run in progress for a deleted task stops; its conversation stays.
    void this.taskSessions.get(id)?.abort();
    this.tasksChanged();
  }

  private runScheduledTaskNow(id: string): void {
    this.requireTask(id);
    if (!this.scheduler?.runNow(id)) throw new Error(t("scheduler.errors.alreadyRunning"));
  }

  private tasksChanged(): void {
    emit({ type: "settings_changed", scopes: ["scheduledTasks"] });
    this.scheduler?.refresh();
  }

  /**
   * Runs a task in its own Pi session (a saved conversation titled after the task), apart from
   * the open conversation, which it neither reads nor disturbs. Nobody is there to approve:
   * tools whose policy is not `allow` are denied, and the model is told so.
   */
  private async runScheduledTask(task: ScheduledTask): Promise<void> {
    const services = this.requireServices();
    const startedAt = Date.now();
    const target = task.target ?? { mode: "new" as const };
    let denied = 0;
    let timedOut = false;
    let session: AgentSession | null = null;
    let mcpServers: McpRegistrations | null = null;
    let outcome: Pick<TaskRun, "status" | "error"> = { status: "completed" };
    let runDelivery: string | undefined;
    let reply: AssistantMessage | undefined;
    let limit: NodeJS.Timeout | undefined;
    try {
      const { settings, paths, mcpConfig } = services;
      const agent = findAgent(settings.get().agents, task.agentId);
      const workspace = findWorkspace(settings.get().workspaces, task.workspaceId);
      const cwd = this.workspaceFor(workspace);
      let manager: SessionManager;
      if (target.mode === "session") {
        const namedFile =
          this.findSessionPath(target.sessionId) ??
          (task.lastRun?.sessionPath && existsSync(task.lastRun.sessionPath)
            ? task.lastRun.sessionPath
            : null);
        if (namedFile && existsSync(namedFile)) {
          manager = SessionManager.open(namedFile, paths.sessionDir, cwd);
        } else {
          manager = SessionManager.create(cwd, paths.sessionDir);
          manager.appendCustomEntry(AGENT_ENTRY_TYPE, { agentId: agent.id });
          manager.appendSessionInfo(task.name);
        }
      } else {
        manager = SessionManager.create(cwd, paths.sessionDir);
        manager.appendCustomEntry(AGENT_ENTRY_TYPE, { agentId: agent.id });
        manager.appendSessionInfo(runTitle(task.name, new Date(startedAt), currentLanguage()));
      }
      let originContext = "";
      if (target.mode === "current") {
        const originFile =
          this.findSessionPath(target.sessionId) ??
          (task.origin ? this.findSessionPath(task.origin) : null);
        if (originFile && existsSync(originFile)) {
          const originManager = SessionManager.open(originFile, paths.sessionDir);
          const branch = originManager.getBranch();
          const lines = historyLines(
            branch.flatMap((e) => (e.type === "message" ? [e.message] : [])),
          );
          const tail = lines.slice(-10);
          if (tail.length > 0) {
            originContext = tail
              .map((line) => `${line.role === "user" ? "User" : "Assistant"}: ${line.text}`)
              .join("\n\n");
          }
        }
      }
      mcpServers = new McpRegistrations(
        mcpConfig,
        (name) => agent.mcpServers === null || agent.mcpServers.includes(name),
      );
      session = await this.buildSession(manager, null, {
        agent: () => agent,
        workspace: () => workspace,
        mcpServers,
        approvalGate: this.gateFor(
          () => agent,
          async () => {
            denied += 1;
            return false;
          },
          SCHEDULED_DENIED_REASON,
        ),
        systemNote: {
          section: "scheduled_task",
          text: originContext
            ? `${scheduledTaskNote(task.name)}\n\nRecent context from the originating conversation:\n${originContext}`
            : scheduledTaskNote(task.name),
        },
        surface: { kind: "task", label: `the scheduled run "${task.name}"` },
        visibility: "self",
      });
      if (!session.model) throw new Error(t("models.noneChosen"));
      this.taskSessions.set(task.id, session);
      limit = setTimeout(() => {
        timedOut = true;
        void session?.abort();
      }, TASK_RUN_LIMIT_MS);
      // The agent's MCP servers connect in the background; wait for them to settle.
      if (mcpServers.hasServers()) await this.mcp.status(session).catch(() => undefined);
      await session.prompt(task.prompt);
      await session.waitForIdle();
      reply = session.messages.findLast(
        (message): message is AssistantMessage => message.role === "assistant",
      );
      if (timedOut) outcome = { status: "failed", error: t("scheduler.errors.timedOut") };
      else if (reply?.stopReason === "error")
        outcome = {
          status: "failed",
          error: reply.errorMessage ?? t("scheduler.errors.runFailed"),
        };
      else if (reply?.stopReason === "aborted")
        outcome = { status: "failed", error: t("scheduler.errors.stopped") };
      else if (!reply) outcome = { status: "failed", error: t("scheduler.errors.noAnswer") };
    } catch (error) {
      outcome = { status: "failed", error: errorMessage(error) };
    } finally {
      clearTimeout(limit);
      this.taskSessions.delete(task.id);
    }
    // Deliver the result according to the task's delivery setting.
    const finalText =
      reply?.content?.find(
        (b): b is { type: "text"; text: string } => (b as { type?: string }).type === "text",
      )?.text ?? "";
    const isSilent = task.silentIfEmpty && finalText.trim() === "[SILENT]";
    if (outcome.status === "completed" && !isSilent) {
      const delivery = task.delivery ?? { to: "session" as const };
      if (delivery.to === "peer") {
        try {
          await this.deliverToPeer(delivery.peer, task.name, finalText);
          runDelivery = "sent";
        } catch (error) {
          runDelivery = `failed: ${(error as Error).message}`;
        }
      } else if (delivery.to === "session") {
        if (target.mode === "current") {
          const committed = await this.commitToOriginSession(
            target.sessionId,
            task.origin,
            task.name,
            finalText,
          );
          runDelivery = committed ? "session" : "failed: origin session not found";
        } else {
          runDelivery = "session";
        }
      } else {
        runDelivery = "none";
      }
    }
    const run: TaskRun = {
      at: startedAt,
      durationMs: Date.now() - startedAt,
      ...outcome,
      deniedTools: denied,
      ...(session?.sessionFile ? { sessionPath: session.sessionFile } : {}),
      ...(runDelivery ? { delivery: runDelivery } : {}),
    };
    mcpServers?.detach();
    session?.dispose();
    this.updateTask(task.id, (draft) => {
      draft.lastRun = run;
    });
    // A one-shot task that asked to be removed after firing is gone now.
    if (task.deleteAfterRun) {
      this.requireServices().settings.update((draft) => {
        draft.scheduledTasks = draft.scheduledTasks.filter((entry) => entry.id !== task.id);
      });
    }
    emit({ type: "settings_changed", scopes: ["scheduledTasks"] });
    emit({ type: "sessions_changed" });
  }
  private findSessionPath(idOrPath: string): string | null {
    const { paths } = this.requireServices();
    if (existsSync(idOrPath)) return idOrPath;
    const ref = sessionRef(idOrPath);
    const candidate = join(paths.sessionDir, `${ref}.jsonl`);
    if (existsSync(candidate)) return candidate;
    return null;
  }

  private async commitToOriginSession(
    sessionId: string,
    origin: string | undefined,
    taskName: string,
    text: string,
  ): Promise<boolean> {
    const { paths, chatSessions } = this.requireServices();
    let file = this.findSessionPath(sessionId) ?? (origin ? this.findSessionPath(origin) : null);
    if (!file && origin) {
      for (const [key, current] of chatSessions.entries()) {
        if (key === origin || current.includes(origin)) {
          file = current;
          break;
        }
      }
    }
    if (!file || !existsSync(file)) return false;

    const messageText = `⏰ ${taskName}\n\n${text}`;
    const assistantMessage: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: messageText }],
      api: "openai-codex",
      provider: "scheduled",
      model: "scheduled-task",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };
    if (this.session?.sessionFile === file) {
      this.session.sessionManager.appendMessage(assistantMessage);
      this.transcript.load(branchEntries(this.session.sessionManager));
      emit({ type: "snapshot", snapshot: this.snapshot() });
    } else {
      let activeChat: ChatSession | undefined;
      for (const chat of this.chats.values()) {
        if (chat.session.sessionFile === file) {
          activeChat = chat;
          break;
        }
      }
      if (activeChat) {
        activeChat.session.sessionManager.appendMessage(assistantMessage);
      } else {
        const manager = SessionManager.open(file, paths.sessionDir);
        manager.appendMessage(assistantMessage);
      }
    }
    emit({ type: "sessions_changed" });
    return true;
  }

  /**
   * Delivers a scheduled run's result to a chat. `home` goes to the paired Telegram owner; a
   * peer key like `telegram:123` goes to that configured chat.
   */
  private async deliverToPeer(peer: string, taskName: string, text: string): Promise<void> {
    const message = `⏰ ${taskName}\n\n${text}`;
    // Record the delivery before sending, so a crash can be recovered.
    const deliveryId = randomUUID();
    this.saveDelivery({ id: deliveryId, peer, message, sent: false });
    await this.requireTelegram().deliver(peer, message);
    this.markDeliverySent(deliveryId);
  }

  // Delivery ledger: a JSON file of pending/sent deliveries for crash recovery.
  private deliveryLedgerPath(): string {
    return join(this.requireServices().paths.agentDir, "deliveries.json");
  }

  private loadDeliveries(): Array<{ id: string; peer: string; message: string; sent: boolean }> {
    try {
      return JSON.parse(readFileSync(this.deliveryLedgerPath(), "utf8")) as Array<{
        id: string;
        peer: string;
        message: string;
        sent: boolean;
      }>;
    } catch {
      return [];
    }
  }

  private saveDeliveries(
    deliveries: Array<{ id: string; peer: string; message: string; sent: boolean }>,
  ): void {
    try {
      writeFileSync(this.deliveryLedgerPath(), JSON.stringify(deliveries, null, 2), {
        mode: 0o600,
      });
    } catch {
      // Best effort.
    }
  }

  private saveDelivery(entry: { id: string; peer: string; message: string; sent: boolean }): void {
    const deliveries = this.loadDeliveries();
    deliveries.push(entry);
    // Keep only the last 100 entries.
    this.saveDeliveries(deliveries.slice(-100));
  }

  private markDeliverySent(id: string): void {
    const deliveries = this.loadDeliveries();
    const entry = deliveries.find((d) => d.id === id);
    if (entry) entry.sent = true;
    this.saveDeliveries(deliveries);
  }

  /** Re-sends deliveries that were recorded but never confirmed as sent. */
  private async redeliverPending(): Promise<void> {
    const deliveries = this.loadDeliveries();
    const pending = deliveries.filter((d) => !d.sent);
    for (const entry of pending) {
      try {
        await this.requireTelegram().deliver(entry.peer, entry.message);
        this.markDeliverySent(entry.id);
      } catch {
        // Will retry on next start.
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Background service and chat channels
  // -------------------------------------------------------------------------------------------

  private async setServiceInstalled(installed: boolean): Promise<ServiceStatus> {
    if (installed) await this.service.install();
    else await this.service.uninstall();
    const status = await this.service.status();
    emit({ type: "settings_changed", scopes: ["background"] });
    return status;
  }

  /** Finds a task by name (case-insensitive); throws when none or several match. */
  private findTaskByName(name: string): ScheduledTask {
    const lower = name.toLowerCase();
    const matches = this.requireServices()
      .settings.get()
      .scheduledTasks.filter((task) => task.name.toLowerCase() === lower);
    if (matches.length === 0) throw new Error(t("scheduler.errors.notFound"));
    if (matches.length > 1) throw new Error(`Several tasks match "${name}"; use the exact name.`);
    return matches[0];
  }

  /** The host `schedule_manage` talks to; `scope` decides the agent and workspace of new tasks. */
  private scheduleHost(scope: SessionScope, sessionManager: SessionManager): ScheduleHost {
    return {
      currentSessionId: () => {
        const file = sessionManager.getSessionFile();
        return file ? sessionRef(file) : null;
      },
      create: (input) => {
        const task = this.saveScheduledTask({
          ...input,
          agentId: scope.agent().id,
          workspaceId: scope.workspace().id,
        });
        return { name: task.name, nextRun: task.nextRun };
      },
      list: (): TaskListEntry[] =>
        this.listScheduledTasks().map((task) => ({
          name: task.name,
          schedule: formatSchedule(task.schedule),
          enabled: task.enabled,
          nextRun: task.nextRun,
          lastStatus: task.lastRun?.status,
        })),
      update: (name, patch) => {
        const existing = this.findTaskByName(name);
        this.saveScheduledTask({
          ...existing,
          ...patch,
          id: existing.id,
          name: patch.name ?? existing.name,
        });
      },
      pause: (name) => this.setScheduledTaskEnabled(this.findTaskByName(name).id, false),
      resume: (name) => this.setScheduledTaskEnabled(this.findTaskByName(name).id, true),
      runNow: (name) => this.runScheduledTaskNow(this.findTaskByName(name).id),
      remove: (name) => this.deleteScheduledTask(this.findTaskByName(name).id),
    };
  }

  private requireTelegram(): TelegramService {
    if (!this.telegram) throw new Error(t("app.starting"));
    return this.telegram;
  }

  /**
   * Label, agent, and workspace of a chat (key `telegram:<id>`). Workspace: what the person picked
   * in the chat with `/workspace`, else the channel's own choice in Settings. Agent: what they
   * picked with `/agent`, else the one pinned for the channel, else the workspace's own agent,
   * else the built-in one. A pick whose agent or workspace was deleted is ignored.
   */
  private channelOf(chatKey: string): { label: string; agentId: string; workspaceId: string } {
    if (chatKey.startsWith("telegram:")) {
      const { settings, chatSessions } = this.requireServices();
      const { agents, workspaces, channels } = settings.get();
      const pick = chatSessions.choice(chatKey);
      const known = (id: string) => agents.some((agent) => agent.id === id);
      const workspaceId =
        pick.workspaceId && workspaces.some((workspace) => workspace.id === pick.workspaceId)
          ? pick.workspaceId
          : channels.telegram.workspaceId;
      const workspace = findWorkspace(workspaces, workspaceId);
      return {
        label: "Telegram",
        agentId: chatAgentId(
          [pick.agentId, channels.telegram.agentId, workspace.agentId],
          known,
          DEFAULT_AGENT_ID,
        ),
        workspaceId,
      };
    }
    throw new Error(`Unknown chat channel: ${chatKey}`);
  }

  private chatOptions(chatKey: string): ChatChoices {
    const { agents, workspaces } = this.requireServices().settings.get();
    const channel = this.channelOf(chatKey);
    return {
      agents: agents.map((agent) => ({ id: agent.id, label: `${agent.icon} ${agent.name}` })),
      workspaces: workspaces.map((workspace) => ({
        id: workspace.id,
        label: `${workspace.icon} ${workspace.name}`,
      })),
      // A deleted default falls back to the built-in one when the session opens.
      agentId: findAgent(agents, channel.agentId).id,
      workspaceId: findWorkspace(workspaces, channel.workspaceId).id,
    };
  }

  /** Models that can run, or the thinking levels of the chat's current model. */
  private chatPickOptions(chatKey: string, kind: ChatPickKind): Promise<ChatPick> {
    if (this.turnsPending.has(chatKey)) throw new Error(t("conversations.waitForAnswer"));
    return this.chatQueue.run(chatKey, async () => {
      const { session } = await this.chatSession(chatKey);
      if (kind === "thinking") {
        if (!session.model || !session.supportsThinking()) return { options: [], currentId: null };
        return {
          options: session
            .getAvailableThinkingLevels()
            .map((level) => ({ id: level, label: level })),
          currentId: session.thinkingLevel,
        };
      }
      const models = await availableModels(this.requireServices().runtime, this.gatewayIds);
      const current = session.model;
      return {
        options: models
          .filter((model) => !model.needsKey)
          .map((model) => ({
            id: modelPickId(model),
            label: `${model.name} · ${model.providerName}`,
          })),
        currentId: current
          ? modelPickId({ provider: current.provider, modelId: current.id })
          : null,
      };
    });
  }

  /** Changes the model or thinking level of this chat's conversation (not the app's defaults). */
  private chatPick(chatKey: string, kind: ChatPickKind, id: string): Promise<void> {
    if (this.turnsPending.has(chatKey)) throw new Error(t("conversations.waitForAnswer"));
    return this.chatQueue.run(chatKey, async () => {
      const { session } = await this.chatSession(chatKey);
      if (kind === "thinking") {
        const levels: readonly string[] = session.supportsThinking()
          ? session.getAvailableThinkingLevels()
          : [];
        if (!levels.includes(id))
          throw new Error(t("settings.unknownThinkingLevel", { level: id }));
        session.setThinkingLevel(id as ThinkingLevel);
        return;
      }
      const { runtime } = this.requireServices();
      const ref = parseModelPickId(id);
      let model = ref ? findAvailable(runtime, ref) : undefined;
      if (ref && !model) {
        await runtime.getAvailable();
        model = findAvailable(runtime, ref);
      }
      if (!model) throw new Error(t("models.notAvailableInSettings"));
      await session.setModel(model);
    });
  }

  /** A new agent continues the conversation; a new workspace starts a new one. */
  private chooseForChat(
    chatKey: string,
    choice: { agentId?: string; workspaceId?: string },
  ): Promise<void> {
    return this.chatQueue.run(chatKey, async () => {
      const { settings, paths, chatSessions, runtime } = this.requireServices();
      const { agents, workspaces } = settings.get();
      if (choice.agentId !== undefined && !agents.some((agent) => agent.id === choice.agentId))
        throw new Error(t("channels.telegram.unknownAgent"));
      if (
        choice.workspaceId !== undefined &&
        !workspaces.some((workspace) => workspace.id === choice.workspaceId)
      )
        throw new Error(t("channels.telegram.unknownWorkspace"));
      const now = this.chatOptions(chatKey);
      const agentId =
        choice.agentId !== undefined && choice.agentId !== now.agentId ? choice.agentId : undefined;
      const workspaceId =
        choice.workspaceId !== undefined && choice.workspaceId !== now.workspaceId
          ? choice.workspaceId
          : undefined;
      if (agentId === undefined && workspaceId === undefined) return;
      chatSessions.setChoice(chatKey, {
        ...(agentId !== undefined && { agentId }),
        ...(workspaceId !== undefined && { workspaceId }),
      });
      // The next turn opens the session again with the new pick.
      this.closeChat(chatKey);
      if (workspaceId !== undefined) {
        chatSessions.drop(chatKey);
        return;
      }
      const file = chatSessions.get(chatKey);
      if (agentId !== undefined && file && existsSync(file)) {
        // As in the window, the conversation moves to the new agent and to its model, if it has one.
        const manager = SessionManager.open(file, paths.sessionDir);
        manager.appendCustomEntry(AGENT_ENTRY_TYPE, { agentId });
        const model = findAvailable(runtime, findAgent(agents, agentId).model);
        if (model) manager.appendModelChange(model.provider, model.id);
      }
    });
  }

  /** The chat's session, built on the chat's saved conversation or a new one. */
  private async chatSession(chatKey: string): Promise<ChatSession> {
    const channel = this.channelOf(chatKey);
    const existing = this.chats.get(chatKey);
    if (existing) {
      if (existing.agentId === channel.agentId && existing.workspaceId === channel.workspaceId) {
        // Edits to the agent's tools apply from the next turn, as in the window.
        this.applyActiveTools(existing.session, this.chatScope(existing, chatKey));
        return existing;
      }
      this.closeChat(chatKey);
    }
    const chat = await this.openChat(chatKey, channel);
    this.chats.set(chatKey, chat);
    this.chatUsed.set(chatKey, Date.now());
    this.chatSweep ??= setInterval(() => this.releaseIdleChats(), CHAT_SWEEP_MS).unref();
    return chat;
  }

  /** Agent and workspace are read from settings on use, so edits and deletions apply live. */
  private chatScope(
    chat: Pick<ChatRuntime, "turn" | "pending" | "cancelQuestions"> & {
      agentId: string;
      workspaceId: string;
    },
    chatKey: string,
    mcpServers: McpRegistrations = this.requireServices().mcpServers,
  ): SessionScope {
    const { settings } = this.requireServices();
    const agent = () => findAgent(settings.get().agents, chat.agentId);
    return {
      agent,
      workspace: () => findWorkspace(settings.get().workspaces, chat.workspaceId),
      mcpServers,
      approvalGate: this.gateFor(agent, (request) => this.askInChat(chat, request)),
      askUser: (call, signal) => this.askQuestionInChat(chat, call, signal),
      systemNote: { section: "channel", text: channelNote(this.channelOf(chatKey).label) },
      surface: { kind: "chat", label: `a ${this.channelOf(chatKey).label} chat (${chatKey})` },
      get visibility() {
        return chatKey === `telegram:${settings.get().channels.telegram.ownerId}` ? "all" : "self";
      },
    };
  }

  private async openChat(
    chatKey: string,
    channel: { label: string; agentId: string; workspaceId: string },
  ): Promise<ChatSession> {
    const { settings, paths, mcpConfig, chatSessions } = this.requireServices();
    const agent = findAgent(settings.get().agents, channel.agentId);
    const workspace = findWorkspace(settings.get().workspaces, channel.workspaceId);
    const cwd = this.workspaceFor(workspace);
    const file = chatSessions.get(chatKey);
    let manager: SessionManager;
    if (file && existsSync(file)) {
      manager = SessionManager.open(file, paths.sessionDir);
      if (manager.getCwd() !== cwd) manager = SessionManager.open(file, paths.sessionDir, cwd);
    } else {
      manager = SessionManager.create(cwd, paths.sessionDir);
      manager.appendCustomEntry(AGENT_ENTRY_TYPE, { agentId: agent.id });
      manager.appendSessionInfo(channelTitle(channel.label, new Date(), currentLanguage()));
    }
    const mcpServers = new McpRegistrations(mcpConfig, (name) => {
      const { mcpServers: allowed } = findAgent(settings.get().agents, agent.id);
      return allowed === null || allowed.includes(name);
    });
    const runtime: ChatRuntime & { agentId: string; workspaceId: string } = {
      turn: null,
      pending: new Set(),
      cancelQuestions: new Set(),
      stopped: false,
      agentId: agent.id,
      workspaceId: workspace.id,
    };
    const session = await this.buildSession(
      manager,
      manager.buildSessionContext().model,
      this.chatScope(runtime, chatKey, mcpServers),
    );
    if (!session.model) {
      mcpServers.detach();
      session.dispose();
      throw new Error(t("models.noneChosen"));
    }
    // The agent's MCP servers connect in the background; wait for them to settle.
    if (mcpServers.hasServers()) await this.mcp.status(session).catch(() => undefined);
    const unsubscribe = session.subscribe((event) => this.onChatEvent(runtime, event));
    return Object.assign(runtime, { session, mcpServers, unsubscribe });
  }

  /** Streams the turn in progress to its channel. */
  private onChatEvent(chat: ChatRuntime, event: AgentSessionEvent): void {
    const turn = chat.turn;
    if (!turn) return;
    try {
      switch (event.type) {
        case "message_update":
          if (event.message.role === "assistant")
            turn.hooks.onText(
              [...turn.texts, assistantText(event.message)].filter(Boolean).join("\n\n"),
            );
          break;
        case "message_end":
          if (event.message.role === "assistant") {
            turn.texts.push(assistantText(event.message));
            turn.reply = event.message;
          }
          break;
        case "tool_execution_start":
          turn.hooks.onTool(describeToolCall(event.toolName, event.args ?? {}).title);
          break;
      }
    } catch (error) {
      // A channel that fails to show progress must not break the turn.
      console.error("Chat channel callback failed:", error);
    }
  }

  /** Gate `ask` of a chat: the person answers in the chat; with nobody to ask, deny. */
  private askInChat(chat: Pick<ChatRuntime, "turn" | "pending">, request: ApprovalRequest) {
    const hooks = chat.turn?.hooks;
    if (!hooks) return Promise.resolve(false);
    const { promise, resolve } = Promise.withResolvers<boolean>();
    chat.pending.add(resolve);
    const settle = (approved: boolean) => {
      if (chat.pending.delete(resolve)) resolve(approved);
    };
    try {
      hooks.askApproval(request).then(settle, () => settle(false));
    } catch {
      settle(false);
    }
    return promise;
  }

  /** `ask_user` of a chat: the person answers in the chat; with nobody to ask, skip. */
  private askQuestionInChat(
    chat: Pick<ChatRuntime, "turn" | "cancelQuestions">,
    call: { toolCallId: string; questions: Question[] },
    signal?: AbortSignal,
  ): Promise<QuestionAnswer[] | null> {
    const hooks = chat.turn?.hooks;
    if (!hooks || signal?.aborted) return Promise.resolve(null);
    const request: QuestionRequest = { requestId: randomUUID(), ...call };
    const { promise, resolve } = Promise.withResolvers<QuestionAnswer[] | null>();
    const settle = (answers: QuestionAnswer[] | null) => {
      if (!chat.cancelQuestions.delete(cancel)) return;
      signal?.removeEventListener("abort", cancel);
      resolve(answers);
    };
    const cancel = () => settle(null);
    chat.cancelQuestions.add(cancel);
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      hooks.askQuestion(request).then(settle, () => settle(null));
    } catch {
      settle(null);
    }
    return promise;
  }

  private denyChatApprovals(chat: Pick<ChatRuntime, "pending" | "cancelQuestions">): void {
    for (const resolve of chat.pending) resolve(false);
    chat.pending.clear();
    for (const cancel of [...chat.cancelQuestions]) cancel();
  }

  /** Releases the chat's session (the conversation stays on disk). */
  private closeChat(chatKey: string): void {
    const chat = this.chats.get(chatKey);
    if (!chat) return;
    this.chats.delete(chatKey);
    this.chatUsed.delete(chatKey);
    this.denyChatApprovals(chat);
    chat.unsubscribe();
    chat.mcpServers.detach();
    chat.session.dispose();
    if (this.chats.size === 0 && this.chatSweep) {
      clearInterval(this.chatSweep);
      this.chatSweep = null;
    }
  }

  private releaseIdleChats(): void {
    for (const chatKey of idleChats(this.chatUsed, (key) => this.chatQueue.busy(key), Date.now())) {
      // Queued behind any turn that started since, which then keeps the session.
      this.chatQueue
        .run(chatKey, async () => {
          if (Date.now() - (this.chatUsed.get(chatKey) ?? 0) >= CHAT_IDLE_MS)
            this.closeChat(chatKey);
        })
        .catch(() => undefined);
    }
  }

  private async chatTurn(
    chatKey: string,
    input: ChannelInput,
    hooks: TurnHooks,
  ): Promise<TurnResult> {
    const text = input.text.trim();
    if (!text && input.attachments.length === 0) return { text: "", status: "done" };
    let chat: ChatSession;
    try {
      chat = await this.chatSession(chatKey);
    } catch (error) {
      return { text: "", status: "error", error: errorMessage(error) };
    }
    const { chatSessions } = this.requireServices();
    chat.stopped = false;
    chat.turn = { hooks, texts: [] };
    try {
      // Copy files and encode images before the run, so a bad attachment fails the turn.
      const message = await buildPrompt(
        text || ATTACHMENTS_ONLY_PROMPT,
        input.attachments,
        chat.session.sessionManager.getCwd(),
      );
      if (chat.stopped) return { text: "", status: "aborted" };
      await chat.session.prompt(message.text, { images: message.images });
      await chat.session.waitForIdle();
      const file = chat.session.sessionFile;
      if (file && existsSync(file)) chatSessions.set(chatKey, file);
      return turnResult(chat.turn.reply, chat.stopped, {
        failed: t("scheduler.errors.runFailed"),
        noAnswer: t("scheduler.errors.noAnswer"),
      });
    } catch (error) {
      if (chat.stopped) return { text: "", status: "aborted" };
      return { text: "", status: "error", error: errorMessage(error) };
    } finally {
      chat.turn = null;
      this.denyChatApprovals(chat);
      this.chatUsed.set(chatKey, Date.now());
      emit({ type: "sessions_changed" });
    }
  }

  private async abortChat(chatKey: string): Promise<void> {
    const chat = this.chats.get(chatKey);
    if (!chat?.turn) return;
    chat.stopped = true;
    // Pending approvals block the run; deny them first or abort() would wait forever.
    this.denyChatApprovals(chat);
    await chat.session.abort();
  }

  private async newChat(chatKey: string): Promise<void> {
    await this.abortChat(chatKey);
    await this.chatQueue.run(chatKey, async () => {
      this.closeChat(chatKey);
      this.requireServices().chatSessions.drop(chatKey);
    });
  }

  // -------------------------------------------------------------------------------------------
  // Memory
  // -------------------------------------------------------------------------------------------

  /** Memory is on in Settings › Memory and for the agent. */
  private memoryOn(agent: AgentProfile): boolean {
    return (this.services?.memory.enabled ?? false) && agent.memory;
  }

  private setMemoryEnabled(enabled: boolean): MemoryView {
    const { memory } = this.requireServices();
    memory.setEnabled(enabled);
    // The memory tools join or leave the active set; the notes follow with the next message.
    this.changed(["memory"], { tools: true });
    return memory.view();
  }

  private saveMemoryEntry(
    id: string | undefined,
    text: string,
    tag: string | null,
    workspaceId: string | null | undefined,
  ): MemoryEntry {
    const { memory } = this.requireServices();
    if (typeof workspaceId === "string") this.requireWorkspace(workspaceId);
    // A new note lands in `workspaceId` (null = every workspace); an edit keeps its place
    // unless the caller moves it.
    const result =
      id === undefined
        ? memory.add({ text, tag, workspaceId: workspaceId ?? null })
        : memory.edit(id, { text, tag, workspaceId });
    if (!result.ok) throw new Error(t(`memory.problems.${result.problem}`));
    this.changed(["memory"], {});
    return result.entry;
  }

  private deleteMemoryEntry(id: string): void {
    if (!this.requireServices().memory.remove(id)) throw new Error(t("memory.problems.missing"));
    this.changed(["memory"], {});
  }

  private clearMemory(): void {
    this.requireServices().memory.clear();
    this.changed(["memory"], {});
  }

  // -------------------------------------------------------------------------------------------
  // Guards
  // -------------------------------------------------------------------------------------------

  /** Session paths come from the renderer; only files inside the session folder are accepted. */
  private requireSessionPath(path: string): string {
    const sessionDir = resolve(this.requireServices().paths.sessionDir);
    const target = resolve(path);
    const inside = relative(sessionDir, target);
    if (
      !inside ||
      inside.startsWith("..") ||
      inside.includes(`..${sep}`) ||
      !target.endsWith(".jsonl")
    )
      throw new Error(t("conversations.notInHistory"));
    return target;
  }

  private requireWorkspace(id: string): WorkspaceProfile {
    const workspace = this.requireServices()
      .settings.get()
      .workspaces.find((entry) => entry.id === id);
    if (!workspace) throw new Error(t("workspaces.notFound"));
    return workspace;
  }

  private requireAgent(id: string): AgentProfile {
    const agent = this.requireServices()
      .settings.get()
      .agents.find((entry) => entry.id === id);
    if (!agent) throw new Error(t("agents.notFound"));
    return agent;
  }

  /** MCP commands reach only the servers the open conversation's agent connects to. */
  private requireUsedServer(name: string): void {
    if (!this.requireServices().mcpServers.uses(name))
      throw new Error(
        t("agents.notUsingServer", { agent: this.currentAgent().name, server: name }),
      );
  }

  private requireSession(): AgentSession {
    if (!this.session) throw new Error(t("app.starting"));
    return this.session;
  }

  private requireServices(): Services {
    if (!this.services) throw new Error(t("app.starting"));
    return this.services;
  }
}

function appSettings(store: SettingsStore): AppSettings {
  const {
    defaultModel,
    shellEnabled,
    language,
    toolPolicies,
    disabledSkills,
    activeAgentId,
    thinkingLevel,
    notifications,
    tray,
    shortcutEnabled,
    shortcut,
  } = store.get();
  return {
    defaultModel,
    shellEnabled,
    language,
    notifications,
    tray,
    shortcutEnabled,
    shortcut,
    toolPolicies,
    disabledSkills,
    activeAgentId,
    thinkingLevel,
  };
}

/** Id of a model in `/model`'s list; the provider and model id may contain any character. */
function modelPickId(ref: ModelRef): string {
  return JSON.stringify([ref.provider, ref.modelId]);
}

function parseModelPickId(id: string): ModelRef | null {
  try {
    const parsed: unknown = JSON.parse(id);
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    )
      return { provider: parsed[0], modelId: parsed[1] };
  } catch {
    // Not one of our ids.
  }
  return null;
}

/** Agent recorded on the conversation's branch (the latest `pp-agent` entry), if any. */
function conversationAgentId(manager: SessionManager): string | null {
  const branch = manager.getBranch();
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type !== "custom" || entry.customType !== AGENT_ENTRY_TYPE) continue;
    const data = entry.data as { agentId?: unknown } | undefined;
    if (typeof data?.agentId === "string") return data.agentId;
  }
  return null;
}

function sameList(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((name) => b.includes(name));
}

/**
 * What to apply to the open conversation when its agent changes from `before` to `after`:
 * `switched` when the conversation moved to another agent, else the same agent was edited.
 */
function agentChanges(
  before: AgentProfile,
  after: AgentProfile,
  switched: boolean,
): Partial<PendingChanges> {
  return {
    mcp: !sameList(before.mcpServers, after.mcpServers),
    tools: !sameList(before.tools, after.tools) || before.memory !== after.memory,
    reload: !sameList(before.skills, after.skills),
    agentModel:
      after.model !== null &&
      (switched ||
        before.model?.provider !== after.model.provider ||
        before.model.modelId !== after.model.modelId),
  };
}

/** Trimmed, de-duplicated models with only sensible numbers kept. */
function cleanGatewayModels(models: readonly GatewayModel[]): GatewayModel[] {
  const seen = new Set<string>();
  const clean: GatewayModel[] = [];
  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const entry: GatewayModel = { id };
    const name = model.name?.trim();
    if (name && name !== id) entry.name = name;
    if (model.reasoning !== undefined) entry.reasoning = model.reasoning;
    if (model.images !== undefined) entry.images = model.images;
    if (model.contextWindow && model.contextWindow > 0)
      entry.contextWindow = Math.round(model.contextWindow);
    if (model.maxTokens && model.maxTokens > 0) entry.maxTokens = Math.round(model.maxTokens);
    clean.push(entry);
  }
  if (clean.length === 0) throw new Error(t("gateways.modelRequired"));
  return clean;
}

export type { HostEnvironment, HostOutput, ServiceControl, VaultBackend } from "./host-io.ts";
export type * from "./channels/types.ts";
