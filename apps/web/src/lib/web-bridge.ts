import type {
  AgentCommand,
  AgentEvent,
  AgentSnapshot,
  Attachment,
  DesktopBridge,
  ExportFormat,
} from "@workspace/shared";
import { create } from "zustand";

import { i18n } from "@/lib/i18n";

/**
 * The bridge of the web app the daemon serves on the local network (Settings › Phone access).
 * Commands are POSTed to `/api/command`, events arrive as Server-Sent Events from `/api/events`
 * (read with `fetch`, so the device token travels in a header and never in a URL or a cookie),
 * and attachments are uploaded to the computer first. What only the desktop window can do (the
 * side panel, native dialogs, updates, computer use) is refused or quietly skipped.
 */

const TOKEN_KEY = "pp-agent.device-token";
/** No event and no heartbeat (sent every 20 s) for this long: the stream is dead, reconnect. */
const STALE_MS = 45_000;
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 10_000;

export type WebPhase = "checking" | "unpaired" | "paired" | "unreachable";
export type WebConnection = "connecting" | "online" | "offline";

interface WebSessionState {
  phase: WebPhase;
  /** Whether live updates arrive right now; only meaningful while paired. */
  connection: WebConnection;
  deviceName: string | null;
  appVersion: string | null;
}

export const useWebSession = create<WebSessionState>()(() => ({
  phase: "checking",
  connection: "connecting",
  deviceName: null,
  appVersion: null,
}));

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Private browsing without storage: the device pairs again next time.
  }
}

function authHeaders(): Record<string, string> {
  const token = readToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** The device's token was refused: it was signed out on the computer. */
function signedOut(): void {
  writeToken(null);
  useWebSession.setState({ phase: "unpaired", deviceName: null });
}

async function errorText(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Not JSON: fall back to the status line.
  }
  return response.statusText || `HTTP ${response.status}`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { ...authHeaders(), ...(init.headers as Record<string, string> | undefined) },
    });
  } catch {
    throw new Error(i18n.t("modals:remote.offline"));
  }
  if (response.status === 401) signedOut();
  if (!response.ok) throw new Error(await errorText(response));
  return (await response.json()) as T;
}

/** Asks the computer whether this device is paired; sets the phase accordingly. */
export async function checkSession(): Promise<void> {
  try {
    const response = await fetch("/api/session", { headers: authHeaders() });
    if (!response.ok) throw new Error(await errorText(response));
    const session = (await response.json()) as {
      paired: boolean;
      deviceName: string | null;
      appVersion: string;
    };
    if (!session.paired) writeToken(null);
    useWebSession.setState({
      phase: session.paired ? "paired" : "unpaired",
      deviceName: session.deviceName,
      appVersion: session.appVersion,
    });
  } catch {
    useWebSession.setState({ phase: "unreachable" });
  }
}

/** "Safari on iPhone", "Chrome on Android": what the computer lists this device as. */
function describeDevice(): string {
  const agent = navigator.userAgent;
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Firefox\/|FxiOS/.test(agent)
      ? "Firefox"
      : /Chrome\/|CriOS/.test(agent)
        ? "Chrome"
        : /Safari\//.test(agent)
          ? "Safari"
          : "Browser";
  const system = /iPhone/.test(agent)
    ? "iPhone"
    : /iPad|Macintosh.*Mobile/.test(agent)
      ? "iPad"
      : /Android/.test(agent)
        ? "Android"
        : /Windows/.test(agent)
          ? "Windows"
          : /Mac OS X/.test(agent)
            ? "Mac"
            : /Linux/.test(agent)
              ? "Linux"
              : null;
  return system ? `${browser} on ${system}` : browser;
}

/** Pairs with the one-time code shown on the computer; throws the computer's message on failure. */
export async function pairDevice(code: string): Promise<void> {
  const result = await request<{ token: string; deviceName: string }>("/api/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code.trim(), name: describeDevice() }),
  });
  writeToken(result.token);
  useWebSession.setState({ phase: "paired", deviceName: result.deviceName });
}

/** Forgets this device on the computer, so its token stops working. */
export async function unpairDevice(): Promise<void> {
  try {
    await request("/api/logout", { method: "POST" });
  } finally {
    signedOut();
  }
}

function pickFiles(options: { multiple: boolean; accept?: string }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = options.multiple;
    if (options.accept) input.accept = options.accept;
    // Some mobile browsers only open pickers for inputs in the document.
    input.style.display = "none";
    document.body.append(input);
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => done(Array.from(input.files ?? [])), { once: true });
    input.addEventListener("cancel", () => done([]), { once: true });
    input.click();
  });
}

async function upload(file: File): Promise<Attachment> {
  return request<Attachment>("/api/upload", {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name || "file"),
    },
    body: file,
  });
}

/** Hands a file to the browser's downloads; on phones this opens the share or save sheet. */
function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const EXPORT_TYPES: Record<ExportFormat, string> = {
  md: "text/markdown;charset=utf-8",
  html: "text/html;charset=utf-8",
};

function desktopOnly(): Promise<never> {
  return Promise.reject(new Error(i18n.t("modals:remote.desktopOnlyAction")));
}

const noop = () => () => undefined;

/** Reads `text/event-stream` blocks and hands each `data:` payload on. */
function sseParser(onData: (data: string) => void) {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk.replace(/\r\n/g, "\n");
    let end = buffer.indexOf("\n\n");
    while (end !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(line.startsWith("data: ") ? 6 : 5))
        .join("\n");
      if (data) onData(data);
      end = buffer.indexOf("\n\n");
    }
  };
}

/** One event stream shared by every listener, reconnecting with backoff while the page lives. */
class EventFeed {
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private running = false;
  private wake: (() => void) | null = null;
  private connectedBefore = false;
  private readonly command: DesktopBridge["agent"]["command"];

  constructor(command: DesktopBridge["agent"]["command"]) {
    this.command = command;
    // A phone suspends pages in the background; coming back should not wait for the backoff.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.wake?.();
    });
    window.addEventListener("online", () => this.wake?.());
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    if (!this.running) void this.run();
    return () => {
      this.listeners.delete(listener);
    };
  }

  private dispatch(event: AgentEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
      const timer = setTimeout(finish, ms);
      this.wake = finish;
    });
  }

  /** Events missed while offline are not replayed; a fresh snapshot brings the page up to date. */
  private async resync(): Promise<void> {
    try {
      const snapshot: AgentSnapshot = await this.command({ type: "get_snapshot" });
      this.dispatch({ type: "snapshot", snapshot });
    } catch {
      // The next reconnect tries again.
    }
  }

  private async run(): Promise<void> {
    this.running = true;
    let delay = RETRY_MIN_MS;
    while (this.listeners.size > 0 && useWebSession.getState().phase === "paired") {
      const controller = new AbortController();
      let watchdog = setTimeout(() => controller.abort(), STALE_MS);
      const alive = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => controller.abort(), STALE_MS);
      };
      try {
        useWebSession.setState({ connection: "connecting" });
        const response = await fetch("/api/events", {
          headers: authHeaders(),
          signal: controller.signal,
          cache: "no-store",
        });
        if (response.status === 401) {
          signedOut();
          break;
        }
        if (!response.ok || !response.body) throw new Error(response.statusText);
        useWebSession.setState({ connection: "online" });
        delay = RETRY_MIN_MS;
        if (this.connectedBefore) void this.resync();
        this.connectedBefore = true;
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        const parse = sseParser((data) => {
          try {
            this.dispatch(JSON.parse(data) as AgentEvent);
          } catch {
            // A broken event is skipped; the next snapshot corrects the page.
          }
        });
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          alive();
          parse(value);
        }
      } catch {
        // Offline, suspended, or the computer went away: retry below.
      } finally {
        clearTimeout(watchdog);
      }
      if (useWebSession.getState().phase !== "paired") break;
      useWebSession.setState({ connection: "offline" });
      await this.sleep(delay);
      delay = Math.min(delay * 2, RETRY_MAX_MS);
    }
    this.running = false;
  }
}

export function createWebBridge(): DesktopBridge {
  const command = (async (agentCommand: AgentCommand) => {
    const result = await request<{ ok: true; data: unknown } | { ok: false; error: string }>(
      "/api/command",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(agentCommand),
      },
    );
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }) as DesktopBridge["agent"]["command"];
  const feed = new EventFeed(command);

  return {
    kind: "web",
    agent: {
      command,
      onEvent: (listener) => feed.subscribe(listener),
    },
    files: {
      pick: async () => Promise.all((await pickFiles({ multiple: true })).map(upload)),
      pickSkill: async () => null,
      pathFor: () => "",
      upload,
      openWorkspace: desktopOnly,
      reveal: desktopOnly,
      pickFolder: async () => null,
      openAgentFile: async () => {
        const [file] = await pickFiles({ multiple: false, accept: ".json,application/json" });
        return file ? file.text() : null;
      },
      saveAgentFile: async (suggestedName, json) => {
        download(suggestedName, json, "application/json");
        return true;
      },
      saveExport: async (suggestedName, format, content) => {
        download(suggestedName, content, EXPORT_TYPES[format]);
        return true;
      },
    },
    updates: {
      state: async () => ({
        status: "disabled",
        currentVersion: useWebSession.getState().appVersion ?? "",
      }),
      check: async () => undefined,
      download: async () => undefined,
      install: async () => undefined,
      onState: noop,
    },
    openExternal: async (url) => {
      if (!/^https?:\/\//i.test(url)) throw new Error(i18n.t("modals:remote.onlyWebLinks"));
      window.open(url, "_blank", "noopener,noreferrer");
    },
    shell: {
      onFocusComposer: noop,
      takePendingFocus: async () => false,
      onTogglePanel: noop,
      onCloseTab: noop,
      closeWindow: async () => undefined,
    },
    terminal: {
      list: async () => [],
      create: desktopOnly,
      backlog: desktopOnly,
      write: () => undefined,
      resize: () => undefined,
      close: async () => undefined,
      onData: noop,
      onChanged: noop,
    },
    workspace: {
      list: desktopOnly,
      preview: desktopOnly,
      reveal: desktopOnly,
      attachment: desktopOnly,
      create: desktopOnly,
      rename: desktopOnly,
      remove: desktopOnly,
      watch: async () => undefined,
      onChanged: noop,
    },
    browser: {
      state: desktopOnly,
      open: desktopOnly,
      close: desktopOnly,
      activate: desktopOnly,
      navigate: desktopOnly,
      go: desktopOnly,
      setBounds: () => undefined,
      onState: noop,
      onReveal: noop,
      cookieSources: async () => [],
      cookieSourceRunning: async () => false,
      importCookies: desktopOnly,
    },
    computer: {
      status: desktopOnly,
      requestPermissions: desktopOnly,
    },
    diagnostics: {
      info: desktopOnly,
      export: async () => false,
      reveal: desktopOnly,
      clear: desktopOnly,
      report: () => undefined,
    },
  };
}
