import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  AgentSession,
  ExtensionAPI,
  ExtensionUIContext,
  McpServerConfig,
} from "@earendil-works/pi-coding-agent";
import {
  MCP_EXPOSURES,
  type McpOverview,
  type McpServerSettings,
  type McpServerState,
  type McpServerView,
} from "@workspace/shared";
import type { AuthPrompts } from "./auth-prompts.ts";
import { t } from "./i18n.ts";
import { emit } from "./ipc.ts";

/** A JSON object as read from mcp.json; keys this app does not edit are kept as they are. */
type JsonObject = Record<string, unknown>;

const SERVER_NAME = /^[A-Za-z0-9_-]+$/;

function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  const object = asObject(value);
  if (!object) return undefined;
  const entries = Object.entries(object).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

// ---------------------------------------------------------------------------------------------
// mcp.json
// ---------------------------------------------------------------------------------------------

export interface McpConfigEntry {
  settings: McpServerSettings;
  /** The entry as written in mcp.json. */
  raw: JsonObject;
}

/** `<agentDir>/mcp.json`, in the `mcpServers` shape other MCP clients use. */
export class McpConfigFile {
  constructor(readonly path: string) {}

  /** Raw file text; an empty config when the file does not exist. */
  readText(): string {
    try {
      return readFileSync(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`;
      throw error;
    }
  }

  /** Servers as edited in Settings, in file order, with their raw entries. */
  servers(): McpConfigEntry[] {
    const servers = asObject(this.read().mcpServers) ?? {};
    return Object.entries(servers).flatMap(([name, value]) => {
      const raw = asObject(value);
      return raw ? [{ settings: toSettings(name, raw), raw }] : [];
    });
  }

  saveServer(originalName: string | undefined, server: McpServerSettings): void {
    const name = server.name.trim();
    const file = this.read();
    const servers = asObject(file.mcpServers) ?? {};
    if (originalName !== undefined && !(originalName in servers))
      throw new Error(t("mcp.serverNotFound", { name: originalName }));
    if (name !== originalName) {
      if (!SERVER_NAME.test(name)) throw new Error(t("mcp.serverNameFormat"));
      if (name in servers) throw new Error(t("mcp.serverNameTaken", { name }));
    }
    const entry = applySettings(
      originalName === undefined ? {} : (asObject(servers[originalName]) ?? {}),
      server,
    );
    // Rebuild the object so a renamed server keeps its place in the file.
    const next: JsonObject = {};
    let placed = false;
    for (const [key, value] of Object.entries(servers)) {
      if (key === originalName) {
        next[name] = entry;
        placed = true;
      } else {
        next[key] = value;
      }
    }
    if (!placed) next[name] = entry;
    this.write({ ...file, mcpServers: next });
  }

  deleteServer(name: string): void {
    const file = this.read();
    const servers = { ...asObject(file.mcpServers) };
    if (!(name in servers)) throw new Error(t("mcp.serverNotFound", { name }));
    delete servers[name];
    this.write({ ...file, mcpServers: servers });
  }

  /**
   * Saves pasted JSON. Accepts a full config (`{ "mcpServers": { … } }`) or just the server map that
   * some clients show (`{ "name": { "command": … } }`).
   */
  saveText(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(
        t("mcp.invalidJson", { error: error instanceof Error ? error.message : String(error) }),
      );
    }
    const object = asObject(parsed);
    if (!object) throw new Error(t("mcp.mustBeObject"));
    if ("mcpServers" in object) {
      if (!asObject(object.mcpServers)) throw new Error(t("mcp.serversMustBeObject"));
      this.write(object);
      return;
    }
    const looksLikeServers = Object.values(object).every((value) => {
      const entry = asObject(value);
      return entry !== null && ("command" in entry || "url" in entry);
    });
    if (!looksLikeServers) throw new Error(t("mcp.serversMissing"));
    this.write({ mcpServers: object });
  }

  private read(): JsonObject {
    const text = this.readText();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch {
      throw new Error(t("mcp.fileInvalidJson"));
    }
    const object = asObject(parsed);
    if (!object) throw new Error(t("mcp.fileMustBeObject"));
    return object;
  }

  private write(content: JsonObject): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, `${JSON.stringify(content, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, this.path);
  }
}

function toSettings(name: string, entry: JsonObject): McpServerSettings {
  const exposure =
    entry.exposure === "codemode-deferred"
      ? "codemode"
      : (MCP_EXPOSURES.find((known) => known === entry.exposure) ?? "codemode");
  const settings: McpServerSettings = {
    name,
    enabled: entry.enabled !== false,
    exposure,
    transport: typeof entry.url === "string" ? "http" : "stdio",
  };
  if (typeof entry.description === "string") settings.description = entry.description;
  if (typeof entry.timeout === "number") settings.timeout = entry.timeout;
  if (typeof entry.command === "string") settings.command = entry.command;
  if (Array.isArray(entry.args))
    settings.args = entry.args.filter((arg): arg is string => typeof arg === "string");
  const env = stringRecord(entry.env);
  if (env) settings.env = env;
  if (typeof entry.cwd === "string") settings.cwd = entry.cwd;
  if (typeof entry.url === "string") settings.url = entry.url;
  const headers = stringRecord(entry.headers);
  if (headers) settings.headers = headers;
  return settings;
}

const STDIO_KEYS = ["command", "args", "env", "cwd"] as const;
const HTTP_KEYS = ["url", "headers", "oauth", "auth"] as const;

/** Writes the edited fields over the existing entry, keeping keys Settings does not edit. */
function applySettings(existing: JsonObject, server: McpServerSettings): JsonObject {
  const entry: JsonObject = { ...existing };
  const set = (key: string, value: unknown) => {
    if (value === undefined) delete entry[key];
    else entry[key] = value;
  };
  const text = (value: string | undefined) => value?.trim() || undefined;
  const map = (value: Record<string, string> | undefined) =>
    value && Object.keys(value).length > 0 ? value : undefined;

  set("description", text(server.description));
  // Defaults are left out, as pi's own /mcp does.
  set("enabled", server.enabled ? undefined : false);
  set("exposure", server.exposure === "codemode" ? undefined : server.exposure);
  set("timeout", server.timeout && server.timeout > 0 ? server.timeout : undefined);

  if (server.transport === "stdio") {
    const command = text(server.command);
    if (!command) throw new Error(t("mcp.commandRequired"));
    for (const key of HTTP_KEYS) delete entry[key];
    if (entry.type !== undefined) entry.type = "stdio";
    set("command", command);
    const args = server.args?.filter((arg) => arg !== "");
    set("args", args && args.length > 0 ? args : undefined);
    set("env", map(server.env));
    set("cwd", text(server.cwd));
  } else {
    const url = text(server.url);
    const protocol = url && URL.canParse(url) ? new URL(url).protocol : "";
    if (!url || (protocol !== "https:" && protocol !== "http:"))
      throw new Error(t("mcp.addressRequired"));
    for (const key of STDIO_KEYS) delete entry[key];
    if (entry.type === "stdio") delete entry.type;
    set("url", url);
    set("headers", map(server.headers));
  }
  return entry;
}

// ---------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------

interface ServerStatus {
  state: McpServerState;
  toolCount: number;
  error?: string;
}

const STATES: Record<string, McpServerState> = {
  disabled: "disabled",
  starting: "starting",
  connecting: "connecting",
  connected: "connected",
  failed: "failed",
  "disconnected, reconnects on next call": "disconnected",
};

/**
 * Parses the text of `/mcp` without arguments. Pi's MCP extension has no status API; the format is
 * `formatStatus` in `@earendil-works/pi-coding-agent/dist/extensions/mcp/index.js`:
 * `name: <state>[, N tools] (<exposure>)` followed by error lines indented by four spaces,
 * `name: needs sign-in, run /mcp login name (<exposure>)`, and `config error: …` lines.
 */
export function parseMcpStatus(
  text: string,
  names: readonly string[],
): { servers: Map<string, ServerStatus>; configErrors: string[] } {
  const servers = new Map<string, ServerStatus>();
  const configErrors: string[] = [];
  // Longest names first, so `crm-eu` is not read as a line of `crm`.
  const byLength = [...names].sort((a, b) => b.length - a.length);
  let last: ServerStatus | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("    ") && last) {
      last.error = last.error ? `${last.error}\n${line.trim()}` : line.trim();
      continue;
    }
    last = null;
    if (line.startsWith("config error: ")) {
      configErrors.push(line.slice("config error: ".length));
      continue;
    }
    const name = byLength.find((candidate) => line.startsWith(`${candidate}: `));
    if (!name) continue;
    const rest = line.slice(name.length + 2);
    if (rest.startsWith("needs sign-in")) {
      last = { state: "needs-auth", toolCount: 0 };
    } else {
      const match = /^(.*?)(?:, (\d+) tools)? \([a-z-]+\)$/.exec(rest);
      last = {
        state: STATES[match?.[1] ?? ""] ?? "failed",
        toolCount: match?.[2] ? Number(match[2]) : 0,
      };
    }
    servers.set(name, last);
  }
  return { servers, configErrors };
}

/** HTTP server without an Authorization header or provider token: may sign in with OAuth. */
function usesOAuth(settings: McpServerSettings, raw: JsonObject): boolean {
  if (settings.transport !== "http" || raw.auth !== undefined) return false;
  return !Object.keys(settings.headers ?? {}).some((key) => key.toLowerCase() === "authorization");
}

/**
 * Servers of mcp.json with their state from `statusText` (null while no session runs). Servers the
 * open conversation's agent does not use are listed as disabled, with the reason.
 */
export function buildOverview(
  config: McpConfigFile,
  statusText: string | null,
  registrations: McpRegistrations,
  agentName: string,
): McpOverview {
  let entries: McpConfigEntry[] = [];
  const fileErrors: string[] = [];
  try {
    entries = config.servers();
  } catch (error) {
    fileErrors.push(error instanceof Error ? error.message : String(error));
  }
  const { servers, configErrors } = parseMcpStatus(
    statusText ?? "",
    entries.map((entry) => entry.settings.name),
  );
  const refused: string[] = [];
  const views: McpServerView[] = entries.map(({ settings, raw }) => {
    const failure = registrations.failure(settings.name);
    if (failure) refused.push(`${settings.name}: ${failure}`);
    // Not in the status: pi refused its config, or the change is not applied yet.
    const status: ServerStatus = !settings.enabled
      ? { state: "disabled", toolCount: 0 }
      : !registrations.uses(settings.name)
        ? { state: "disabled", toolCount: 0, error: t("mcp.notUsedBy", { agent: agentName }) }
        : (servers.get(settings.name) ??
          (failure
            ? { state: "failed", toolCount: 0, error: failure }
            : { state: "starting", toolCount: 0 }));
    return {
      settings,
      state: status.state,
      toolCount: status.toolCount,
      ...(status.error ? { error: status.error } : {}),
      usesOAuth: usesOAuth(settings, raw),
    };
  });
  return {
    servers: views,
    configErrors: [...fileErrors, ...configErrors, ...refused],
    configPath: config.path,
  };
}

// ---------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------

/** Prefix of pi's message for a config it refuses; the rest is the reason. */
const INVALID_CONFIG = /^Invalid MCP server registered by extension "[^"]*": /;

/**
 * Connects the servers of mcp.json that the open conversation's agent uses. Pi's own mcp.json
 * loader is switched off (`createMcpExtension({ loadConfig })`); our extension registers the
 * servers with `pi.registerMcpServer`, which connects and disconnects them right away, so an agent
 * switch or an mcp.json edit only touches the servers that changed. Servers registered this way
 * still support pi's `/mcp` status, reconnect, and sign-in.
 */
export class McpRegistrations {
  private api: ExtensionAPI | null = null;
  /** Registered server → its mcp.json entry as JSON, so unchanged servers are left alone. */
  private readonly registered = new Map<string, string>();
  /** Servers whose config pi refused, with the reason. */
  private readonly failures = new Map<string, string>();

  /** `uses(name)`: whether the open conversation's agent connects to the server. */
  constructor(
    private readonly config: McpConfigFile,
    readonly uses: (name: string) => boolean,
  ) {}

  /** The session is gone; its registrations went with it. */
  detach(): void {
    this.api = null;
    this.registered.clear();
    this.failures.clear();
  }

  /** Called by the extension on every load (new session, reload): registers from scratch. */
  attach(pi: ExtensionAPI): void {
    this.api = pi;
    this.registered.clear();
    this.sync();
  }

  /** Registers and unregisters servers until they match mcp.json and the agent. */
  sync(): void {
    const api = this.api;
    if (!api) return;
    const wanted = new Map<string, JsonObject>();
    try {
      for (const { settings, raw } of this.config.servers())
        if (settings.enabled && this.uses(settings.name)) wanted.set(settings.name, raw);
    } catch {
      // A broken mcp.json connects nothing; the MCP section reports the problem.
    }
    for (const name of [...this.registered.keys()]) {
      if (wanted.has(name)) continue;
      api.unregisterMcpServer(name);
      this.registered.delete(name);
    }
    this.failures.clear();
    for (const [name, raw] of wanted) {
      const json = JSON.stringify(raw);
      if (this.registered.get(name) === json) continue;
      try {
        // pi validates the entry and throws for configs it cannot use.
        api.registerMcpServer(name, raw as unknown as McpServerConfig);
        this.registered.set(name, json);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.failures.set(name, message.replace(INVALID_CONFIG, ""));
        if (this.registered.delete(name)) api.unregisterMcpServer(name);
      }
    }
  }

  /** Whether any server is registered for the open conversation. */
  hasServers(): boolean {
    return this.registered.size > 0;
  }

  failure(name: string): string | undefined {
    return this.failures.get(name);
  }
}

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

interface Notice {
  message: string;
  type: "info" | "warning" | "error";
}

interface CommandRun {
  flowTitle: string;
  notices: Notice[];
  /** Forward notices as `auth_info` (sign-in instructions with the URL that was opened). */
  forward: boolean;
}

/**
 * Runs pi's `/mcp` command and captures what it reports. Pi's MCP extension reports through
 * `ctx.ui.notify` and asks through `ctx.ui.input`; each run gets its own capture through async
 * context, so a status check during a sign-in does not mix up their messages.
 */
export class McpCommands {
  private readonly runs = new AsyncLocalStorage<CommandRun>();

  constructor(private readonly prompts: AuthPrompts) {}

  /** UI context bound to every session; everything except notify and input stays a no-op. */
  uiContext(base: ExtensionUIContext): ExtensionUIContext {
    return {
      ...base,
      notify: (message, type = "info") => {
        const run = this.runs.getStore();
        if (!run) return;
        run.notices.push({ message, type });
        if (run.forward && type !== "error") {
          const url = /https?:\/\/\S+/.exec(message)?.[0];
          emit({
            type: "auth_info",
            flowTitle: run.flowTitle,
            message: url ? message.replace(url, "").trim() : message,
            ...(url ? { url } : {}),
          });
        }
      },
      input: async (title, placeholder, options) => {
        const run = this.runs.getStore();
        const value = await this.prompts.ask(
          {
            flowTitle: run?.flowTitle ?? t("mcp.flow.server"),
            kind: "manual_code",
            message: title,
            ...(placeholder ? { placeholder } : {}),
          },
          options?.signal,
        );
        return value ?? undefined;
      },
    };
  }

  /** Status text of every server; waits for connections still starting. */
  async status(session: AgentSession): Promise<string> {
    const notices = await this.run(session, "", t("mcp.flow.status"), false);
    return notices.map((notice) => notice.message).join("\n");
  }

  async reconnect(session: AgentSession, name: string): Promise<void> {
    throwOnError(
      await this.run(session, `reconnect ${name}`, t("mcp.flow.reconnect", { name }), false),
    );
  }

  async signIn(session: AgentSession, name: string): Promise<void> {
    const notices = await this.run(session, `login ${name}`, t("mcp.flow.signIn", { name }), true);
    if (notices.some((notice) => notice.message === "Sign-in cancelled."))
      throw new Error("Cancelled");
    throwOnError(notices);
  }

  async signOut(session: AgentSession, name: string): Promise<void> {
    throwOnError(await this.run(session, `logout ${name}`, t("mcp.flow.signOut", { name }), false));
  }

  private async run(
    session: AgentSession,
    args: string,
    flowTitle: string,
    forward: boolean,
  ): Promise<Notice[]> {
    const runner = session.extensionRunner;
    const command = runner.getCommand("mcp");
    if (!command) throw new Error(t("mcp.unavailable"));
    const run: CommandRun = { flowTitle, notices: [], forward };
    await this.runs.run(run, () => command.handler(args, runner.createCommandContext()));
    return run.notices;
  }
}

function throwOnError(notices: readonly Notice[]): void {
  const error = notices.find((notice) => notice.type === "error");
  if (error) throw new Error(error.message);
}
