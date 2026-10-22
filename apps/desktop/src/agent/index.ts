/**
 * Agent utility process. Runs the pi SDK session off the main thread so a slow tool or a crash
 * never freezes the window. Talks to the main process over `process.parentPort`.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import {
  type AgentSession,
  type AgentSessionEvent,
  createAgentSession,
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
  DefaultResourceLoader,
  type ExtensionAPI,
  type ExtensionFactory,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentCommand,
  AgentEvent,
  AgentPaths,
  AgentSnapshot,
  AgentStatus,
  AgentToMainMessage,
  ApprovalRequest,
  Attachment,
  MainToAgentMessage,
  ProviderConfig,
  SessionSummary,
  ToolSummary,
} from "@workspace/shared";
import { buildPrompt, splitAttachedFiles } from "./attachments.ts";
import { createReadDocumentTool } from "./documents.ts";
import {
  BLOCKED_TOOLS,
  currentDateTimeTool,
  describeToolCall,
  parseMcpToolName,
  SYSTEM_PROMPT,
  TOOL_SELECTION,
  toolTier,
} from "./tools.ts";
import { Transcript } from "./transcript.ts";

const PROVIDER_ID = "pp-gateway";
const TITLE_LENGTH = 80;

const port = process.parentPort;

function send(message: AgentToMainMessage): void {
  port.postMessage(message);
}

function emit(event: AgentEvent): void {
  send({ kind: "event", event });
}

class AgentHost {
  private paths: AgentPaths | null = null;
  private runtime: ModelRuntime | null = null;
  private session: AgentSession | null = null;
  /** Extension API of the current session, used to inspect registered tools. */
  private extensionApi: ExtensionAPI | null = null;
  private unsubscribe: (() => void) | null = null;
  private status: AgentStatus = "starting";
  private modelLabel: string | null = null;
  private readonly approvals = new Map<
    string,
    { request: ApprovalRequest; resolve: (approved: boolean) => void }
  >();
  private readonly transcript = new Transcript((message) => emit({ type: "message", message }));

  async init(paths: AgentPaths, provider: ProviderConfig | null): Promise<void> {
    // Pi's built-in extensions (MCP config, MCP OAuth tokens, logs) resolve the agent directory from
    // this variable rather than the session options; point them at the app's folder, not ~/.pi.
    process.env.PI_CODING_AGENT_DIR = paths.agentDir;
    for (const dir of [paths.workspaceDir, paths.agentDir, paths.sessionDir])
      mkdirSync(dir, { recursive: true });
    this.paths = paths;
    this.runtime = await ModelRuntime.create({
      authPath: `${paths.agentDir}/auth.json`,
      modelsPath: null,
      refreshOnCreate: false,
    });
    if (provider) await this.configure(provider);
    else this.setStatus("unconfigured");
  }

  /** Point the runtime at the gateway. Keeps the conversation when one is already running. */
  async configure(provider: ProviderConfig): Promise<void> {
    const runtime = this.requireRuntime();
    if (runtime.getRegisteredProviderIds().includes(PROVIDER_ID))
      runtime.unregisterProvider(PROVIDER_ID);
    runtime.registerProvider(PROVIDER_ID, {
      name: "Gateway",
      baseUrl: provider.baseUrl,
      api: provider.api,
      models: [
        {
          id: provider.modelId,
          name: provider.modelId,
          api: provider.api,
          reasoning: false,
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 200_000,
          maxTokens: 16_384,
        },
      ],
    });
    // A runtime key is used verbatim; a key in provider config would be interpreted ($ENV, !command).
    await runtime.setRuntimeApiKey(PROVIDER_ID, provider.apiKey);
    const model = runtime.getModel(PROVIDER_ID, provider.modelId);
    if (!model) throw new Error(`Model ${provider.modelId} is not available.`);
    this.modelLabel = provider.modelId;

    if (this.session) await this.session.setModel(model);
    else await this.startSession();
    emit({ type: "snapshot", snapshot: this.snapshot() });
  }

  async handle(command: AgentCommand): Promise<unknown> {
    switch (command.type) {
      case "get_snapshot":
        return this.snapshot();
      case "prompt":
        return this.prompt(command.text, command.attachments);
      case "abort":
        return this.abort();
      case "new_chat":
        return this.openSession(null);
      case "respond_approval":
        return this.resolveApproval(command.requestId, command.approved);
      case "list_sessions":
        return this.listSessions();
      case "open_session":
        return this.openSession(this.requireSessionPath(command.path));
      case "rename_session":
        return this.renameSession(this.requireSessionPath(command.path), command.name);
      case "delete_session":
        return this.deleteSession(this.requireSessionPath(command.path));
      case "list_tools":
        return this.listTools();
    }
  }

  private snapshot(): AgentSnapshot {
    return {
      status: this.status,
      messages: this.transcript.list(),
      approvals: [...this.approvals.values()].map((entry) => entry.request),
      model: this.modelLabel,
      workspaceDir: this.paths?.workspaceDir ?? null,
      sessionPath: this.session?.sessionFile ?? null,
    };
  }

  private async prompt(text: string, attachments: Attachment[]): Promise<void> {
    const session = this.requireSession();
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    // Copy files and encode images before acknowledging, so a bad attachment fails the send.
    const message = await buildPrompt(
      trimmed || "Please take a look at the attached files.",
      attachments,
      this.requirePaths().workspaceDir,
    );
    // prompt() resolves when the whole run finishes; progress arrives through session events.
    const run = session.prompt(message.text, {
      images: message.images,
      ...(session.isStreaming ? { streamingBehavior: "followUp" as const } : {}),
    });
    run.catch((error: unknown) => emit({ type: "error", message: errorMessage(error) }));
  }

  private async abort(): Promise<void> {
    // Pending approvals block the run; deny them first or abort() would wait forever.
    this.denyAllApprovals();
    await this.session?.abort();
  }

  /** Switch to a saved conversation, or to a new one when `path` is null. */
  private async openSession(path: string | null): Promise<void> {
    const paths = this.requirePaths();
    this.requireSession();
    await this.abort();
    this.disposeSession();
    const manager = path
      ? SessionManager.open(path, paths.sessionDir)
      : SessionManager.create(paths.workspaceDir, paths.sessionDir);
    await this.startSession(manager);
    this.transcript.load(this.requireSession().messages);
    emit({ type: "snapshot", snapshot: this.snapshot() });
  }

  private async listSessions(): Promise<SessionSummary[]> {
    const paths = this.requirePaths();
    const sessions = await SessionManager.list(paths.workspaceDir, paths.sessionDir);
    return sessions
      .filter((info) => info.messageCount > 0)
      .sort((a, b) => b.modified.getTime() - a.modified.getTime())
      .map((info) => {
        const firstMessage = splitAttachedFiles(info.firstMessage).text.replace(/\s+/g, " ").trim();
        const title = info.name?.trim() || firstMessage || "Untitled chat";
        return {
          path: info.path,
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
    else SessionManager.open(path, this.requirePaths().sessionDir).appendSessionInfo(trimmed);
    emit({ type: "sessions_changed" });
  }

  private async deleteSession(path: string): Promise<void> {
    if (this.session?.sessionFile === path) await this.openSession(null);
    await rm(path, { force: true });
    emit({ type: "sessions_changed" });
  }

  private listTools(): ToolSummary[] {
    const api = this.extensionApi;
    if (!api) return [];
    return api
      .getAllTools()
      .filter((tool) => tool.exposure !== "hidden" && !BLOCKED_TOOLS[tool.name])
      .map((tool) => ({
        name: tool.name,
        description: tool.description.split("\n")[0] ?? "",
        source: parseMcpToolName(tool.name)?.server ?? "built-in",
        tier: toolTier(tool.name, tool.annotations),
      }))
      .sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
  }

  private async startSession(sessionManager?: SessionManager): Promise<void> {
    const paths = this.requirePaths();
    const runtime = this.requireRuntime();
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: true, maxRetries: 2 },
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd: paths.workspaceDir,
      agentDir: paths.agentDir,
      settingsManager,
      // Only our own extensions run; skills and mcp.json come from <agentDir>, managed by the tech team.
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
      extensionFactories: [
        { name: "approval-gate", factory: this.approvalGate },
        createCodemodeExtension(),
        createToolSearchExtension(),
        createMcpExtension(),
      ],
      systemPrompt: SYSTEM_PROMPT,
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: paths.workspaceDir,
      agentDir: paths.agentDir,
      modelRuntime: runtime,
      model: runtime.getModel(PROVIDER_ID, this.modelLabel ?? ""),
      thinkingLevel: "off",
      tools: TOOL_SELECTION,
      customTools: [currentDateTimeTool, createReadDocumentTool(paths.workspaceDir)],
      resourceLoader,
      settingsManager,
      sessionManager: sessionManager ?? SessionManager.create(paths.workspaceDir, paths.sessionDir),
    });
    // Emits session_start, which connects the MCP servers in the background.
    await session.bindExtensions({
      onError: (error) => emit({ type: "error", message: `${error.event}: ${error.error}` }),
    });
    this.session = session;
    this.unsubscribe = session.subscribe((event) => this.onSessionEvent(event));
    this.setStatus("idle");
  }

  private disposeSession(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.session?.dispose();
    this.session = null;
    this.extensionApi = null;
  }

  private onSessionEvent(event: AgentSessionEvent): void {
    switch (event.type) {
      case "agent_start":
        this.setStatus("running");
        break;
      case "agent_settled":
        this.transcript.flush();
        this.setStatus("idle");
        emit({ type: "sessions_changed" });
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

  /** Extension that asks the person before any tool above the `read` tier runs. */
  private readonly approvalGate: ExtensionFactory = (pi) => {
    this.extensionApi = pi;
    pi.on("tool_call", async (event) => {
      // Built-in shell and edit tools stay registered (codemode can reach any registered tool).
      if (BLOCKED_TOOLS[event.toolName])
        return { block: true, reason: `${event.toolName} is not available in this app.` };
      const info = pi.getAllTools().find((tool) => tool.name === event.toolName);
      const tier = toolTier(event.toolName, info?.annotations);
      if (tier === "read") return undefined;
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

  private setStatus(status: AgentStatus): void {
    if (this.status === status) return;
    this.status = status;
    emit({ type: "status", status });
  }

  /** Session paths come from the renderer; only files inside the session folder are accepted. */
  private requireSessionPath(path: string): string {
    const sessionDir = resolve(this.requirePaths().sessionDir);
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

  private requireSession(): AgentSession {
    if (!this.session) throw new Error("Choose a model in Settings before starting a chat.");
    return this.session;
  }

  private requirePaths(): AgentPaths {
    if (!this.paths) throw new Error("Agent is not initialized.");
    return this.paths;
  }

  private requireRuntime(): ModelRuntime {
    if (!this.runtime) throw new Error("Agent is not initialized.");
    return this.runtime;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const host = new AgentHost();

port.on("message", ({ data }) => {
  const message = data as MainToAgentMessage;
  switch (message.kind) {
    case "init":
      host.init(message.paths, message.provider).catch((error: unknown) => {
        emit({ type: "error", message: errorMessage(error) });
      });
      break;
    case "configure":
      host.configure(message.provider).catch((error: unknown) => {
        emit({ type: "error", message: errorMessage(error) });
      });
      break;
    case "command":
      host.handle(message.command).then(
        (result) => send({ kind: "result", id: message.id, ok: true, data: result }),
        (error: unknown) =>
          send({ kind: "result", id: message.id, ok: false, error: errorMessage(error) }),
      );
      break;
  }
});
