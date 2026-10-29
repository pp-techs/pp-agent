import { isAbsolute, join } from "node:path";
import {
  type AgentCommand,
  type AgentEvent,
  type AgentSnapshot,
  EXPORT_FORMATS,
  IPC,
} from "@workspace/shared";
import { app, BrowserWindow, ipcMain, session, shell } from "electron";
import { DaemonClient } from "./daemon-client.ts";
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
import { chromeUserAgent } from "./browser/address.ts";
import { createSidePanel } from "./panel/ipc.ts";
import { restrictPermissions } from "./permissions.ts";
import { readShellSettings } from "./settings.ts";
import { releaseShortcut, syncShortcut } from "./shortcut.ts";
import { destroyTray, refreshTray, syncTray, trayActive } from "./tray.ts";
import { migrateLegacyProvider } from "./legacy.ts";
import { migrateLegacyVault } from "./legacy-vault.ts";
import { createUpdater } from "./updates.ts";

const DIST_DIR = import.meta.dirname;
/** Window icon for Windows and Linux (macOS takes the Dock icon from the app bundle). */
const WINDOW_ICON = join(
  app.isPackaged ? process.resourcesPath : join(DIST_DIR, "..", "resources"),
  "icons",
  "icon.png",
);
/** Unpackaged runs load the renderer dev server (`vp dev` in apps/web); packaged builds load bundled files. */
const RENDERER_URL = app.isPackaged
  ? null
  : (process.env.ELECTRON_RENDERER_URL ?? "http://localhost:47821");
/** Folder the agent reads and writes; attachments are copied here too. */
const WORKSPACE_DIR = join(app.getPath("documents"), "PP Agent");
const USER_DATA_DIR = app.getPath("userData");
const SETTINGS_FILE = join(USER_DATA_DIR, "settings.json");
initI18n(SETTINGS_FILE);

const updater = createUpdater((state) => window?.webContents.send(IPC.updatesEvent, state));

let window: BrowserWindow | null = null;
/** The shortcut fired while no page was loaded to receive the event; the renderer asks on mount. */
let pendingFocus = false;
let quitting = false;

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

/** Opens http(s) URLs in the default browser; anything else is refused. */
async function openExternal(url: string): Promise<void> {
  const protocol = URL.canParse(url) ? new URL(url).protocol : "";
  if (protocol !== "https:" && protocol !== "http:")
    throw new Error(translator()("app.onlyWebLinks"));
  await shell.openExternal(url);
}

/** Folder with OfficeCLI and the built-in skills, for the daemon. */
const RESOURCES_DIR = app.isPackaged ? process.resourcesPath : join(DIST_DIR, "..", "resources");

const daemon = new DaemonClient({
  home: USER_DATA_DIR,
  daemonScript: join(DIST_DIR, "daemon.mjs"),
  resourcesDir: RESOURCES_DIR,
  appVersion: app.getVersion(),
  onEvent(event) {
    sendToRenderer(event);
    notifier.handle(event);
    if (event.type === "settings_changed" && event.scopes.includes("settings"))
      applyShellSettings();
    if (event.type === "settings_changed" && event.scopes.includes("browserProfiles"))
      void sidePanel.syncProfiles();
  },
  onOpenUrl(url) {
    openExternal(url).catch((error: unknown) => {
      console.error("Could not open link:", error);
    });
  },
  onLost() {
    sendToRenderer({ type: "error", message: translator()("app.stoppedUnexpectedly") });
    sendToRenderer({ type: "status", status: "starting" });
  },
  onStartFailed(error) {
    sendToRenderer({ type: "error", message: error.message });
    sendToRenderer({ type: "status", status: "starting" });
  },
  onConnected() {
    void syncWithDaemon();
  },
});

/**
 * After every (re)connection: show the daemon's state, clear the data of deleted browser profiles,
 * and hand over a leftover old vault.
 */
async function syncWithDaemon(): Promise<void> {
  try {
    const snapshot = (await daemon.command({ type: "get_snapshot" })) as AgentSnapshot;
    sendToRenderer({ type: "snapshot", snapshot });
  } catch (error) {
    console.error("Could not read the agent's state:", error);
  }
  await sidePanel.syncProfiles();
  try {
    await migrateLegacyVault((entries) => daemon.importCredentials(entries));
  } catch (error) {
    console.error("Could not move the saved sign-ins to the background service:", error);
  }
}

async function startDaemon(): Promise<void> {
  // Before the daemon starts, so it reads the settings.json this writes.
  await migrateLegacyProvider(SETTINGS_FILE).catch((error: unknown) => {
    console.error("Settings migration failed:", error);
  });
  daemon.start();
}

function commandAgent(command: AgentCommand): Promise<unknown> {
  return daemon.command(command);
}

const sidePanel = createSidePanel({
  window: () => window,
  command: commandAgent,
  settingsFile: SETTINGS_FILE,
  workspaceDir: WORKSPACE_DIR,
  userDataDir: USER_DATA_DIR,
});

function createWindow(): void {
  window = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 640,
    minHeight: 480,
    title: "PP Agent",
    icon: WINDOW_ICON,
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
    sidePanel.windowClosed();
  });
  sidePanel.attach(window);

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
ipcMain.handle(IPC.updatesInstall, () =>
  // Mark the app as quitting before the updater closes the windows: with the tray on, a plain
  // close hides the window to the tray and the update would never install or restart.
  updater.install(() => {
    quitting = true;
  }),
);

app.on("before-quit", () => {
  quitting = true;
  daemon.dispose();
  sidePanel.dispose();
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
  // Side panel pages present as plain Chrome (sites such as Google sign-in refuse unknown
  // browsers). Only the fallback reaches `navigator.userAgent`, and only of pages created later.
  app.userAgentFallback = chromeUserAgent(process.platform, process.versions.chrome);
  restrictPermissions(session.defaultSession, () => window);
  void startDaemon();
  createWindow();
  applyShellSettings();
  updater.start();
});
