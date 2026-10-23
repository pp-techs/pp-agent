/**
 * Agent utility process. Runs the pi SDK session off the main thread so a slow tool or a crash
 * never freezes the window. Talks to the main process over `process.parentPort`.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
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
  DEFAULT_AGENT_ID,
  DEFAULT_WORKSPACE_ID,
  GATEWAY_APIS,
  type GatewayConfig,
  type GatewayModel,
  type GatewayView,
  type MainToAgentMessage,
  type McpServerSettings,
  type ModelRef,
  type ModelSummary,
  type ProviderSummary,
  type SaveAgentInput,
  type SaveWorkspaceInput,
  type SaveGatewayInput,
  type SaveSkillInput,
  type SkillSummary,
  type SessionSummary,
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
import { buildPrompt, splitAttachedFiles } from "./attachments.ts";
import { AuthPrompts } from "./auth-prompts.ts";
import { VaultCredentialStore } from "./credentials.ts";
import { createReadDocumentTool } from "./documents.ts";
import { emit, errorMessage, send } from "./ipc.ts";
import { buildOverview, McpCommands, McpConfigFile, McpRegistrations } from "./mcp.ts";
import {
  authInteraction,
  availableModels,
  fetchGatewayModels,
  findAvailable,
  listProviders,
  newGatewayId,
  normalizeBaseUrl,
  summarizeModel,
  syncGateways,
} from "./providers.ts";
import { SettingsStore } from "./settings-store.ts";
import { SkillLibrary } from "./skills.ts";
import {
  activeToolsFor,
  agentAllowsTool,
  currentDateTimeTool,
  describeToolCall,
  isListedTool,
  parseMcpToolName,
  SYSTEM_PROMPT,
  toolRule,
  toolSelection,
  toolTier,
} from "./tools.ts";
import { Transcript } from "./transcript.ts";

const TITLE_LENGTH = 80;
const NO_MODEL_MESSAGE = "Choose a model in Settings › Models before starting a chat.";

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
  mcpConfig: McpConfigFile;
  /** MCP servers connected for the open conversation's agent. */
  mcpServers: McpRegistrations;
}

class AgentHost {
  private services: Services | null = null;
  private readonly ready = Promise.withResolvers<Services>();
  readonly credentials = new VaultCredentialStore();
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
  private readonly transcript = new Transcript((message) => emit({ type: "message", message }));

  constructor() {
    // Commands wait for `ready`; a failed init must not also surface as an unhandled rejection.
    this.ready.promise.catch(() => undefined);
  }

  async init(paths: AgentPaths): Promise<void> {
    try {
      // Pi's built-in extensions (MCP config, MCP OAuth tokens, logs) resolve the agent directory
      // from this variable rather than the session options; point them at the app's folder.
      process.env.PI_CODING_AGENT_DIR = paths.agentDir;
      const skillsDir = join(paths.agentDir, "skills");
      for (const dir of [paths.workspaceDir, paths.agentDir, paths.sessionDir, skillsDir])
        mkdirSync(dir, { recursive: true });
      const settings = new SettingsStore(paths.settingsFile);
      const runtime = await ModelRuntime.create({
        credentials: this.credentials,
        modelsPath: null,
        refreshOnCreate: false,
      });
      const mcpConfig = new McpConfigFile(join(paths.agentDir, "mcp.json"));
      const services: Services = {
        paths,
        runtime,
        settings,
        skills: new SkillLibrary(skillsDir),
        mcpConfig,
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
          message: `Saved sign-ins could not be read: ${errorMessage(error)}`,
        });
      }
      await this.startSession(this.newSessionManager());
      this.ready.resolve(services);
      emit({ type: "snapshot", snapshot: this.snapshot() });
    } catch (error) {
      this.ready.reject(error);
      throw error;
    }
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
        return availableModels(services.runtime);
      case "set_model":
        return this.setModel({ provider: command.provider, modelId: command.modelId });

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

      default: {
        const unknown: never = command;
        throw new Error(`Unknown command: ${JSON.stringify(unknown)}`);
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
    if (!this.currentModel()) throw new Error(NO_MODEL_MESSAGE);
    // Copy files and encode images before acknowledging, so a bad attachment fails the send.
    const message = await buildPrompt(
      trimmed || "Please take a look at the attached files.",
      attachments,
      session.sessionManager.getCwd(),
    );
    // prompt() resolves when the whole run finishes; progress arrives through session events.
    const run = session.prompt(message.text, {
      images: message.images,
      ...(session.isStreaming ? { streamingBehavior: "followUp" as const } : {}),
    });
    run.catch((error: unknown) => emit({ type: "error", message: errorMessage(error) }));
  }

  private async compact(): Promise<void> {
    const session = this.requireSession();
    if (this.running || session.isStreaming) throw new Error("Wait for the answer to finish.");
    if (session.isCompacting) return;
    const short = "This conversation is still short, so there is nothing to summarize yet.";
    if (session.messages.length === 0) throw new Error(short);
    try {
      await session.compact();
    } catch (error) {
      // Pi refuses when the recent messages it keeps already cover the whole conversation.
      if (/nothing to compact/i.test(errorMessage(error))) throw new Error(short);
      throw error;
    }
    emit({ type: "sessions_changed" });
    emit({ type: "context", context: this.contextUsage() });
  }

  private async abort(): Promise<void> {
    // Pending approvals block the run; deny them first or abort() would wait forever.
    this.denyAllApprovals();
    await this.session?.abort();
  }

  /** Switch to a saved conversation, or to a new one (in `workspaceId`, else the open workspace). */
  private async openSession(path: string | null, workspaceId: string | null = null): Promise<void> {
    await this.abort();
    this.disposeSession();
    await this.startSession(
      path ? this.savedSessionManager(path) : this.newSessionManager(workspaceId),
    );
    this.transcript.load(branchMessages(this.requireSession()));
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
        message: `The folder of workspace ${workspace.name} cannot be used (${errorMessage(error)}). Using the default folder instead.`,
      });
      return paths.workspaceDir;
    }
  }

  private async listSessions(): Promise<SessionSummary[]> {
    const { paths, settings } = this.requireServices();
    const { workspaces } = settings.get();
    // Conversations of every workspace and agent.
    const sessions = await SessionManager.listAll(paths.sessionDir);
    return sessions
      .filter((info) => info.messageCount > 0)
      .sort((a, b) => b.modified.getTime() - a.modified.getTime())
      .map((info) => {
        const skill = parseSkillBlock(info.firstMessage);
        const firstMessage = splitAttachedFiles(
          skill ? (skill.userMessage ?? "") : info.firstMessage,
        )
          .text.replace(/\s+/g, " ")
          .trim();
        const title =
          info.name?.trim() || firstMessage || (skill ? `Skill: ${skill.name}` : "Untitled chat");
        return {
          path: info.path,
          workspaceId: workspaceForCwd(workspaces, info.cwd, paths.workspaceDir).id,
          title: title.length > TITLE_LENGTH ? `${title.slice(0, TITLE_LENGTH - 1)}…` : title,
          modified: info.modified.getTime(),
          messageCount: info.messageCount,
        };
      });
  }

  private renameSession(path: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Enter a name.");
    if (this.session?.sessionFile === path) this.session.setSessionName(trimmed);
    else
      SessionManager.open(path, this.requireServices().paths.sessionDir).appendSessionInfo(trimmed);
    emit({ type: "sessions_changed" });
  }

  private async deleteSession(path: string): Promise<void> {
    if (this.session?.sessionFile === path) await this.openSession(null);
    await rm(path, { force: true });
    emit({ type: "sessions_changed" });
  }

  /**
   * Model for a conversation: `preferred` (a saved chat's own model) when still usable, else the
   * agent's model, else the default model, else the first available one.
   */
  private chooseModel(preferred: ModelRef | null): Model<Api> | undefined {
    const { runtime, settings } = this.requireServices();
    const first = [...runtime.getAvailableSnapshot()].sort((a, b) => {
      const providerA = runtime.getProvider(a.provider)?.name ?? a.provider;
      const providerB = runtime.getProvider(b.provider)?.name ?? b.provider;
      return providerA.localeCompare(providerB) || a.name.localeCompare(b.name);
    })[0];
    return (
      findAvailable(runtime, preferred) ??
      findAvailable(runtime, this.currentAgent().model) ??
      findAvailable(runtime, this.currentWorkspace().model) ??
      findAvailable(runtime, settings.get().defaultModel) ??
      first
    );
  }

  /** Starts the conversation of `sessionManager` (its cwd is the agent's workspace). */
  private async startSession(
    sessionManager: SessionManager,
    preferredModel: ModelRef | null = sessionManager.buildSessionContext().model,
  ): Promise<void> {
    const { paths, runtime, settings, skills } = this.requireServices();
    const cwd = sessionManager.getCwd();
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
        { name: "approval-gate", factory: this.approvalGate },
        { name: "pp-agent", factory: this.agentExtension },
        createCodemodeExtension(),
        createToolSearchExtension(),
        // Pi's own mcp.json loading is off: the agent extension registers the agent's servers.
        createMcpExtension({
          loadConfig: () => ({ servers: [], errors: [] }),
          openUrl: (url) => send({ kind: "open_url", url }),
        }),
      ],
      // Read on every reload, so enabling or disabling a skill applies with `session.reload()`.
      skillsOverride: (base) => {
        const disabled = settings.get().disabledSkills;
        const allowed = this.currentAgent().skills;
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
      model: this.chooseModel(preferredModel),
      // A saved conversation keeps its own level (pi restores it); a new one uses the last pick.
      thinkingLevel:
        sessionManager.buildSessionContext().messages.length > 0
          ? undefined
          : (this.currentWorkspace().thinkingLevel ?? settings.get().thinkingLevel),
      tools: toolSelection(settings.get(), this.currentAgent().tools),
      customTools: [currentDateTimeTool, createReadDocumentTool(cwd)],
      resourceLoader,
      settingsManager,
      sessionManager,
    });
    // Emits session_start, which connects the MCP servers in the background. The UI context lets
    // Settings drive pi's `/mcp` command (status, reconnect, sign-in).
    await session.bindExtensions({
      uiContext: this.mcp.uiContext(session.extensionRunner.getUIContext()),
      mode: "rpc",
      onError: (error) => emit({ type: "error", message: `${error.event}: ${error.error}` }),
    });
    this.session = session;
    this.unsubscribe = session.subscribe((event) => this.onSessionEvent(event));
    // The new session already reflects every setting.
    this.pending = { ...NO_CHANGES };
    this.applyActiveTools(session);
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
      case "agent_start":
        this.running = true;
        this.refreshStatus();
        break;
      case "agent_settled":
        this.running = false;
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

  /** Extension that applies tool policies and asks the person before tools that need it. */
  private readonly approvalGate: ExtensionFactory = (pi) => {
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
      const agent = this.currentAgent();
      if (!agentAllowsTool(agent.tools, event.toolName))
        return { block: true, reason: `${event.toolName} is not available to ${agent.name}.` };
      if (rule.effective === "allow") return undefined;
      const approved = await this.requestApproval({
        requestId: randomUUID(),
        toolCallId: event.toolCallId,
        anchorToolCallId: event.parentToolCallId ?? event.toolCallId,
        toolName: event.toolName,
        tier,
        ...describeToolCall(event.toolName, event.input),
      });
      return approved ? undefined : { block: true, reason: "The user declined this action." };
    });
  };

  /**
   * Extension of the open conversation's agent: connects its MCP servers and adds its rules to the
   * system prompt (read on every prompt, so edits apply from the next message).
   */
  private readonly agentExtension: ExtensionFactory = (pi) => {
    this.requireServices().mcpServers.attach(pi);
    pi.on("before_agent_start", (event) => {
      const { sections } = event.systemPromptOptions;
      const agentSection = agentPromptSection(this.currentAgent());
      if (agentSection) sections.agent = agentSection;
      else delete sections.agent;
      const workspaceSection = workspacePromptSection(this.currentWorkspace());
      if (workspaceSection) sections.workspace = workspaceSection;
      else delete sections.workspace;
    });
  };

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
        emit({ type: "error", message: `Settings could not be applied: ${errorMessage(error)}` });
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
    this.transcript.load(branchMessages(next));
    return next;
  }

  private applyActiveTools(session: AgentSession): void {
    const current = session.getActiveToolNames();
    const next = activeToolsFor(
      current,
      this.requireServices().settings.get(),
      this.currentAgent().tools,
    );
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
        message: `${ref.modelId} is not available; keeping ${current?.name ?? "the current model"}.`,
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

  private async updateSettings(
    patch: Partial<Pick<AppSettings, "defaultModel" | "shellEnabled">>,
  ): Promise<AppSettings> {
    const { runtime, settings } = this.requireServices();
    const scopes: SettingsScope[] = ["settings"];
    const apply: Partial<PendingChanges> = {};
    const before = settings.get();
    if (patch.defaultModel) {
      await runtime.getAvailable();
      if (!findAvailable(runtime, patch.defaultModel))
        throw new Error("That model is not available. Connect its provider first.");
    }
    const after = settings.update((draft) => {
      if (patch.defaultModel !== undefined) draft.defaultModel = patch.defaultModel;
      if (typeof patch.shellEnabled === "boolean") draft.shellEnabled = patch.shellEnabled;
    });
    if (after.shellEnabled !== before.shellEnabled) {
      scopes.push("tools");
      apply.tools = true;
    }
    // A conversation that has not started yet follows the new default model, unless its agent or
    // workspace brings its own.
    const session = this.session;
    if (
      patch.defaultModel &&
      session &&
      !this.running &&
      session.messages.length === 0 &&
      !findAvailable(runtime, this.currentAgent().model) &&
      !findAvailable(runtime, this.currentWorkspace().model)
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
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    try {
      await runtime.login(
        providerId,
        "api_key",
        authInteraction(this.prompts, `Connect ${provider.name}`),
      );
    } catch (error) {
      // The key was saved; only the local refresh failed, and the next refresh catches up.
      if (!(error instanceof CredentialSynchronizationError)) throw error;
    }
    this.changed(["providers", "models"], { model: true });
    const summary = (await listProviders(runtime, this.gatewayIds)).find(
      (entry) => entry.id === providerId,
    );
    if (!summary) throw new Error(`Unknown provider: ${providerId}`);
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
    if (!name) throw new Error("Enter a name for the gateway.");
    if (!GATEWAY_APIS.includes(input.api)) throw new Error(`Unsupported API: ${input.api}`);
    const baseUrl = normalizeBaseUrl(input.api, input.baseUrl);
    const models = cleanGatewayModels(input.models);
    if (input.id !== undefined && !settings.get().gateways.some((entry) => entry.id === input.id))
      throw new Error("This gateway no longer exists.");

    let gateway: GatewayConfig | undefined;
    const saved = settings.update((draft) => {
      const id = input.id ?? newGatewayId(name, new Set(draft.gateways.map((entry) => entry.id)));
      gateway = { id, name, api: input.api, baseUrl, models };
      const index = draft.gateways.findIndex((entry) => entry.id === id);
      if (index === -1) draft.gateways.push(gateway);
      else draft.gateways[index] = gateway;
    });
    if (!gateway) throw new Error("The gateway could not be saved.");
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
    if (!model)
      throw new Error("That model is not available. Connect its provider in Settings › Models.");
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
    if (!THINKING_LEVELS.includes(level)) throw new Error(`Unknown thinking level: ${level}`);
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
    if (!TOOL_POLICIES.includes(policy)) throw new Error(`Unknown policy: ${policy}`);
    if (toolRule(name, toolTier(name), settings.get()).locked)
      throw new Error("This tool's setting cannot be changed here.");
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
    if (id === DEFAULT_AGENT_ID) throw new Error("The built-in agent cannot be deleted.");
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
      throw new Error("The agent chosen for this workspace no longer exists.");
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
    if (id === DEFAULT_WORKSPACE_ID) throw new Error("The built-in workspace cannot be deleted.");
    const { settings } = this.requireServices();
    this.requireWorkspace(id);
    settings.update((draft) => {
      draft.workspaces = draft.workspaces.filter((entry) => entry.id !== id);
    });
    // Its conversations stay on disk and show up in the default workspace.
    const open = this.workspaceId === id;
    if (open) this.workspaceId = DEFAULT_WORKSPACE_ID;
    this.changed(["workspaces"], { workspace: open });
    emit({ type: "sessions_changed" });
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
      throw new Error("That conversation is not in this app's history.");
    return target;
  }

  private requireWorkspace(id: string): WorkspaceProfile {
    const workspace = this.requireServices()
      .settings.get()
      .workspaces.find((entry) => entry.id === id);
    if (!workspace) throw new Error("This workspace no longer exists.");
    return workspace;
  }

  private requireAgent(id: string): AgentProfile {
    const agent = this.requireServices()
      .settings.get()
      .agents.find((entry) => entry.id === id);
    if (!agent) throw new Error("This agent no longer exists.");
    return agent;
  }

  /** MCP commands reach only the servers the open conversation's agent connects to. */
  private requireUsedServer(name: string): void {
    if (!this.requireServices().mcpServers.uses(name))
      throw new Error(
        `${this.currentAgent().name} does not use ${name}. Add it to the agent in Settings › Agents, or switch to an agent that uses it.`,
      );
  }

  private requireSession(): AgentSession {
    if (!this.session) throw new Error("The agent is still starting.");
    return this.session;
  }

  private requireServices(): Services {
    if (!this.services) throw new Error("The agent is still starting.");
    return this.services;
  }
}

/**
 * Every message on the conversation's branch, including those a compaction summarized away
 * (`session.messages` holds only what the model still sees), so the chat shows its full history.
 */
function branchMessages(session: AgentSession): AgentMessage[] {
  return session.sessionManager
    .getBranch()
    .flatMap((entry) => (entry.type === "message" ? [entry.message] : []));
}

function appSettings(store: SettingsStore): AppSettings {
  const { defaultModel, shellEnabled, toolPolicies, disabledSkills, activeAgentId, thinkingLevel } =
    store.get();
  return {
    defaultModel,
    shellEnabled,
    toolPolicies,
    disabledSkills,
    activeAgentId,
    thinkingLevel,
  };
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
    tools: !sameList(before.tools, after.tools),
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
  if (clean.length === 0) throw new Error("Add at least one model.");
  return clean;
}

const host = new AgentHost();

process.parentPort.on("message", ({ data }) => {
  const message = data as MainToAgentMessage;
  switch (message.kind) {
    case "init":
      host.init(message.paths).catch((error: unknown) => {
        emit({ type: "error", message: `The agent could not start: ${errorMessage(error)}` });
      });
      break;
    case "command":
      host.handle(message.command).then(
        (result) => send({ kind: "result", id: message.id, ok: true, data: result }),
        (error: unknown) =>
          send({ kind: "result", id: message.id, ok: false, error: errorMessage(error) }),
      );
      break;
    case "vault_result":
      host.credentials.resolve(message);
      break;
  }
});
