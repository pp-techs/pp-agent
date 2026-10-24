import { isAbsolute, join } from "node:path";
import {
  type AgentCommand,
  type AgentEvent,
  type AgentToMainMessage,
  EXPORT_FORMATS,
  IPC,
  type MainToAgentMessage,
  type VaultRequest,
} from "@workspace/shared";
import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell,
  type UtilityProcess,
  utilityProcess,
} from "electron";
import {
  isInside,
  openAgentFile,
  openFolder,
  pickFiles,
  pickFolder,
  pickSkill,
  saveAgentFile,
  saveExportFile,
} from "./files.ts";
import { initI18n, translator } from "./i18n.ts";
import { createNotifier, type Notifier } from "./notifications.ts";
import { restrictPermissions } from "./permissions.ts";
import { readShellSettings } from "./settings.ts";
import { releaseShortcut, syncShortcut } from "./shortcut.ts";
import { destroyTray, refreshTray, syncTray, trayActive } from "./tray.ts";
import { resolveShellPath } from "./shell-path.ts";
import { migrateLegacyProvider } from "./legacy.ts";
import { createUpdater } from "./updates.ts";
import { handleVaultRequest } from "./vault.ts";

const DIST_DIR = import.meta.dirname;
/** Unpackaged runs load the renderer dev server (`vp dev` in apps/web); packaged builds load bundled files. */
const RENDERER_URL = app.isPackaged
  ? null
  : (process.env.ELECTRON_RENDERER_URL ?? "http://localhost:47821");
const RESTART_DELAY_MS = 1_000;
/** Folder the agent reads and writes; attachments are copied here too. */
const WORKSPACE_DIR = join(app.getPath("documents"), "PP Agent");
const USER_DATA_DIR = app.getPath("userData");
const SETTINGS_FILE = join(USER_DATA_DIR, "settings.json");
initI18n(SETTINGS_FILE);

const updater = createUpdater((state) => window?.webContents.send(IPC.updatesEvent, state));

let window: BrowserWindow | null = null;
/** The shortcut fired while no page was loaded to receive the event; the renderer asks on mount. */
let pendingFocus = false;
let agent: UtilityProcess | null = null;
let nextCommandId = 0;
let quitting = false;
/** Resolves once the legacy provider.json has been migrated; the agent starts after it. */
let migration: Promise<void> | null = null;
/** Resolved once: asking the login shell takes a moment and the answer does not change. */
let shellPath: Promise<string | undefined> | null = null;
const pending = new Map<
  number,
  { resolve: (data: unknown) => void; reject: (error: Error) => void }
>();

function sendToRenderer(event: AgentEvent): void {
  window?.webContents.send(IPC.agentEvent, event);
}

/** Brings the window to the front, creating it when it was closed. */
function showWindow(): void {
  if (!window) {
    createWindow();
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  app.focus({ steal: true });
}

/** Shows the window and puts the cursor in the message box. */
function showAndFocusComposer(): void {
  const created = !window;
  showWindow();
  if (created || !window || window.webContents.isLoading()) pendingFocus = true;
  else window.webContents.send(IPC.shellFocusComposer);
}

const notifier: Notifier = createNotifier({
  window: () => window,
  enabled: () => readShellSettings(SETTINGS_FILE).notifications,
  activate(sessionPath) {
    showWindow();
    // Another conversation may have been opened since; go back to the one the alert was about.
    if (sessionPath && sessionPath !== notifier.currentSession()) {
      commandAgent({ type: "open_session", path: sessionPath }).catch((error: unknown) => {
        console.error("Could not open the conversation from the notification:", error);
      });
    }
  },
});

/** Sends an event once the page has loaded (a toast sent earlier would be lost). */
function sendWhenLoaded(event: AgentEvent): void {
  const target = window;
  if (!target) return;
  if (!target.webContents.isLoading()) {
    sendToRenderer(event);
    return;
  }
  target.webContents.once("did-finish-load", () => setTimeout(() => sendToRenderer(event), 800));
}

/** Makes the tray icon and the global shortcut match settings.json. */
function applyShellSettings(): void {
  const settings = readShellSettings(SETTINGS_FILE);
  syncTray(
    settings.tray,
    {
      windowShown: () => !!window && window.isVisible() && !window.isMinimized(),
      toggleWindow() {
        if (window?.isVisible() && !window.isMinimized()) window.hide();
        else showWindow();
        refreshTray();
      },
      newChat() {
        showAndFocusComposer();
        commandAgent({ type: "new_chat" }).catch((error: unknown) => {
          console.error("Could not start a new chat from the tray:", error);
        });
      },
      quit: () => app.quit(),
    },
    DIST_DIR,
  );
  const result = syncShortcut(settings.shortcutEnabled, settings.shortcut, showAndFocusComposer);
  if (result === "failed") {
    sendWhenLoaded({
      type: "error",
      message: translator()("shell.shortcut.failed", { shortcut: settings.shortcut }),
    });
  }
}

function postToAgent(message: MainToAgentMessage): void {
  if (!agent) throw new Error(translator()("app.notRunning"));
  agent.postMessage(message);
}

/** Opens http(s) URLs in the default browser; anything else is refused. */
async function openExternal(url: string): Promise<void> {
  const protocol = URL.canParse(url) ? new URL(url).protocol : "";
  if (protocol !== "https:" && protocol !== "http:")
    throw new Error(translator()("app.onlyWebLinks"));
  await shell.openExternal(url);
}

function answerVault(child: UtilityProcess, id: number, request: VaultRequest): void {
  handleVaultRequest(request).then(
    (data) => {
      const message: MainToAgentMessage = { kind: "vault_result", id, ok: true, data };
      child.postMessage(message);
    },
    (error: unknown) => {
      const message: MainToAgentMessage = {
        kind: "vault_result",
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
      child.postMessage(message);
    },
  );
}

async function startAgent(): Promise<void> {
  migration ??= migrateLegacyProvider(SETTINGS_FILE).catch((error: unknown) => {
    console.error("Settings migration failed:", error);
  });
  await migration;

  const PATH = await (shellPath ??= resolveShellPath());
  const child = utilityProcess.fork(join(DIST_DIR, "agent.mjs"), [], {
    serviceName: "PP Agent",
    stdio: "inherit",
    env: PATH ? { ...process.env, PATH } : process.env,
  });
  agent = child;

  child.on("message", (message: AgentToMainMessage) => {
    switch (message.kind) {
      case "event":
        sendToRenderer(message.event);
        notifier.handle(message.event);
        if (message.event.type === "settings_changed" && message.event.scopes.includes("settings"))
          applyShellSettings();
        return;
      case "vault":
        answerVault(child, message.id, message.request);
        return;
      case "open_url":
        openExternal(message.url).catch((error: unknown) => {
          console.error("Could not open link:", error);
        });
        return;
      case "result": {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.ok) request.resolve(message.data);
        else request.reject(new Error(message.error));
      }
    }
  });

  child.on("exit", (code) => {
    if (agent !== child) return;
    agent = null;
    const t = translator();
    for (const request of pending.values()) request.reject(new Error(t("app.stoppedUnexpectedly")));
    pending.clear();
    if (quitting) return;
    sendToRenderer({
      type: "error",
      message: t("app.stoppedRestarting", { code }),
    });
    sendToRenderer({ type: "status", status: "starting" });
    setTimeout(() => void startAgent(), RESTART_DELAY_MS);
  });

  postToAgent({
    kind: "init",
    paths: {
      workspaceDir: WORKSPACE_DIR,
      agentDir: join(USER_DATA_DIR, "agent"),
      sessionDir: join(USER_DATA_DIR, "sessions"),
      settingsFile: SETTINGS_FILE,
    },
    systemLocale: app.getLocale(),
  });
}

function commandAgent(command: AgentCommand): Promise<unknown> {
  nextCommandId += 1;
  const id = nextCommandId;
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  pending.set(id, { resolve, reject });
  try {
    postToAgent({ kind: "command", id, command });
  } catch (error) {
    pending.delete(id);
    reject(error);
  }
  return promise;
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 640,
    minHeight: 480,
    title: "PP Agent",
    show: false,
    webPreferences: {
      preload: join(DIST_DIR, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.once("ready-to-show", () => window?.show());
  // With the tray icon on, closing the window keeps the app running in the tray.
  window.on("close", (event) => {
    if (quitting || !trayActive()) return;
    event.preventDefault();
    window?.hide();
  });
  window.on("show", refreshTray);
  window.on("hide", refreshTray);
  window.on("minimize", refreshTray);
  window.on("restore", refreshTray);
  window.on("closed", () => {
    window = null;
  });

  // Links in agent replies open in the browser; the app window never navigates away.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  if (RENDERER_URL) {
    const url = RENDERER_URL;
    // The dev server may still be starting; keep retrying until it answers.
    window.webContents.on("did-fail-load", () => setTimeout(() => void window?.loadURL(url), 500));
    void window.loadURL(url);
  } else {
    void window.loadFile(join(process.resourcesPath, "renderer", "index.html"));
  }
}

ipcMain.handle(IPC.agentCommand, (_event, command: AgentCommand) => commandAgent(command));
ipcMain.handle(IPC.filesPick, () => pickFiles(window));
ipcMain.handle(IPC.filesPickSkill, () => pickSkill(window));
ipcMain.handle(IPC.filesOpenWorkspace, (_event, dir: unknown) => {
  // Only folders can be opened this way, never files (opening a file could run it).
  if (typeof dir !== "string" || !isAbsolute(dir))
    throw new Error(translator()("app.folderCannotOpen"));
  return openFolder(dir);
});
ipcMain.handle(IPC.filesPickFolder, () => pickFolder(window));
ipcMain.handle(IPC.filesOpenAgent, () => openAgentFile(window));
ipcMain.handle(IPC.filesSaveAgent, (_event, suggestedName: unknown, json: unknown) => {
  if (typeof suggestedName !== "string" || typeof json !== "string")
    throw new Error(translator()("app.agentCannotExport"));
  return saveAgentFile(window, suggestedName, json);
});
ipcMain.handle(
  IPC.filesSaveExport,
  (_event, suggestedName: unknown, format: unknown, content: unknown) => {
    const known = EXPORT_FORMATS.find((candidate) => candidate === format);
    if (typeof suggestedName !== "string" || !known || typeof content !== "string")
      throw new Error(translator()("app.conversationCannotExport"));
    return saveExportFile(window, suggestedName, known, content);
  },
);
ipcMain.handle(IPC.filesReveal, (_event, path: unknown) => {
  // Only the app's own files (skills, mcp.json) and the workspace can be shown.
  if (typeof path !== "string" || !(isInside(USER_DATA_DIR, path) || isInside(WORKSPACE_DIR, path)))
    throw new Error(translator()("app.locationCannotShow"));
  shell.showItemInFolder(path);
});
ipcMain.handle(IPC.openExternal, (_event, url: unknown) => {
  if (typeof url !== "string") throw new Error(translator()("app.onlyWebLinks"));
  return openExternal(url);
});

ipcMain.handle(IPC.shellTakePendingFocus, () => {
  const wasPending = pendingFocus;
  pendingFocus = false;
  return wasPending;
});

ipcMain.handle(IPC.updatesState, () => updater.state());
ipcMain.handle(IPC.updatesCheck, () => updater.check(true));
ipcMain.handle(IPC.updatesDownload, () => updater.download(openExternal));
ipcMain.handle(IPC.updatesInstall, () => updater.install());

app.on("before-quit", () => {
  quitting = true;
  agent?.kill();
});

app.on("will-quit", () => {
  releaseShortcut();
  destroyTray();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  // Clicking the Dock icon brings back a window hidden to the tray, too.
  showWindow();
});

// No top-level await: Electron emits `ready` only after the ESM main module finishes evaluating.
void app.whenReady().then(() => {
  restrictPermissions(session.defaultSession, () => window);
  void startAgent();
  createWindow();
  applyShellSettings();
  updater.start();
});
