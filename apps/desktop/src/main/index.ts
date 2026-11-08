import { homedir, release } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveDaemonPaths } from "@workspace/daemon/paths";
import {
  type AgentCommand,
  type AgentEvent,
  type AgentSnapshot,
  ARTIFACT_FRAME_URL,
  EXPORT_FORMATS,
  IPC,
  type RendererReport,
} from "@workspace/shared";
import { app, BrowserWindow, session, shell } from "electron";
import { handleArtifactScheme, registerArtifactScheme } from "./artifact-protocol.ts";
import { AuditLog, buildReport } from "./audit-log.ts";
import { DaemonClient } from "./daemon-client.ts";
import {
  isInside,
  openAgentFile,
  openFolder,
  pickFiles,
  pickFolder,
  pickSkill,
  saveAgentFile,
  saveDiagnosticsFile,
  saveExportFile,
} from "./files.ts";
import { initI18n, translator } from "./i18n.ts";
import { createNotifier, type Notifier } from "./notifications.ts";
import { chromeUserAgent } from "./browser/address.ts";
import { ComputerHost } from "./computer/host.ts";
import { createSidePanel } from "./panel/ipc.ts";
import { restrictPermissions } from "./permissions.ts";
import { DesktopSettings } from "./settings.ts";
import { releaseShortcut, syncShortcut } from "./shortcut.ts";
import { destroyTray, refreshTray, syncTray, trayActive } from "./tray.ts";
import { migrateLegacyProvider } from "./legacy.ts";
import { migrateLegacyVault } from "./legacy-vault.ts";
import { createUpdater } from "./updates.ts";
import { appPageMatcher, createTrustedIpc } from "./trusted-ipc.ts";

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
/** Every IPC handler answers only the main frame of the app window showing the app's own page. */
const ipc = createTrustedIpc(
  () => window,
  appPageMatcher(
    RENDERER_URL,
    pathToFileURL(join(process.resourcesPath, "renderer", "index.html")).href,
  ),
);
/** Folder the agent reads and writes; attachments are copied here too. */
const WORKSPACE_DIR = join(app.getPath("documents"), "PP Agent");
const USER_DATA_DIR = app.getPath("userData");
const SETTINGS_FILE = join(USER_DATA_DIR, "settings.json");
initI18n(SETTINGS_FILE);
/** settings.json as main uses it, re-read only when the daemon says it changed. */
const settings = new DesktopSettings(SETTINGS_FILE, WORKSPACE_DIR);

/** What the person sends to whoever debugs a problem; see "Diagnostics" in Settings › General. */
const audit = new AuditLog({ dir: join(USER_DATA_DIR, "logs"), home: homedir() });
/** The background service's own log, whose tail goes into the diagnostics report. */
const DAEMON_LOG_FILE = resolveDaemonPaths({
  ...process.env,
  PP_AGENT_HOME: USER_DATA_DIR,
}).logFile;
const DAEMON_LOG_REPORT_BYTES = 256 * 1024;
audit.record("app_start", {
  version: app.getVersion(),
  packaged: app.isPackaged,
  platform: process.platform,
  arch: process.arch,
  os: release(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  locale: app.getLocale(),
});
// Only watches: the app keeps handling these as it did, the log just notes them.
process.on("uncaughtExceptionMonitor", (error, origin) => {
  audit.record("main_exception", { origin, error: error.stack ?? error.message });
});

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
  enabled: () => settings.shell.notifications,
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
  const shell = settings.shell;
  syncTray(
    shell.tray,
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
  const result = syncShortcut(shell.shortcutEnabled, shell.shortcut, showAndFocusComposer);
  if (result === "failed") {
    sendWhenLoaded({
      type: "error",
      message: translator()("shell.shortcut.failed", { shortcut: shell.shortcut }),
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
/** Where each HTML preview library lives in node_modules; electron-builder copies them for packaged builds. */
const ARTIFACT_LIB_SOURCES: Record<string, string> = {
  "chart.js": join("chart.js", "dist", "chart.umd.min.js"),
};
function artifactLibPath(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, "artifact-libs", name)
    : join(DIST_DIR, "..", "node_modules", ARTIFACT_LIB_SOURCES[name] ?? name);
}
registerArtifactScheme();

/** cua-driver for the agent's computer tool; it runs as a child of this process (see ComputerHost). */
const computer = new ComputerHost({
  resourcesDir: RESOURCES_DIR,
  userDataDir: USER_DATA_DIR,
  // `appId` in electron-builder.yml.
  bundleId: "com.pptechs.agent",
  log: (line) => console.log(line),
});

const daemon = new DaemonClient({
  home: USER_DATA_DIR,
  daemonScript: join(DIST_DIR, "daemon.mjs"),
  resourcesDir: RESOURCES_DIR,
  appVersion: app.getVersion(),
  onEvent(event) {
    audit.event(event, { session: notifier.currentSession() });
    sendToRenderer(event);
    notifier.handle(event);
    if (
      event.type === "settings_changed" &&
      (event.scopes.includes("settings") || event.scopes.includes("workspaces"))
    )
      settings.refresh();
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
  onBrowserRequest(request) {
    if (!window) return Promise.reject(new Error("The PP Agent window is closed."));
    return sidePanel.runBrowserRequest(request);
  },
  onComputerRequest(request, signal) {
    if (!window) return Promise.reject(new Error("The PP Agent window is closed."));
    return computer.run(request, signal);
  },
  onLost() {
    audit.record("daemon_lost");
    sendToRenderer({ type: "error", message: translator()("app.stoppedUnexpectedly") });
    sendToRenderer({ type: "status", status: "starting" });
  },
  onStartFailed(error) {
    audit.record("daemon_start_failed", { error: error.message });
    sendToRenderer({ type: "error", message: error.message });
    sendToRenderer({ type: "status", status: "starting" });
  },
  onConnected() {
    audit.record("daemon_connected");
    // settings.json may have changed while no daemon was connected.
    settings.refresh();
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
  settings.refresh();
  daemon.start();
}

function commandAgent(command: AgentCommand): Promise<unknown> {
  return daemon.command(command).catch((error: unknown) => {
    // The command's own fields are left out: they carry what the person typed.
    audit.record("command_failed", {
      command: command.type,
      error: error instanceof Error ? error.message : String(error),
      session: notifier.currentSession(),
    });
    throw error;
  });
}

const sidePanel = createSidePanel({
  window: () => window,
  ipc,
  command: commandAgent,
  settings,
  userDataDir: USER_DATA_DIR,
});

function createWindow(): void {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
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
  window.webContents.on("render-process-gone", (_event, details) => {
    audit.record("render_process_gone", { reason: details.reason, exitCode: details.exitCode });
  });
  window.on("unresponsive", () => audit.record("window_unresponsive"));
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
    daemon.setBrowserAvailable(false);
    daemon.setComputerAvailable(false);
  });
  sidePanel.attach(window);
  daemon.setBrowserAvailable(true);
  daemon.setComputerAvailable(computer.supported);

  // Links in agent replies open in the browser; the app window never navigates away.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  // HTML previews are iframes in the chat and the Files panel; a link clicked inside one goes nowhere.
  window.webContents.on("will-frame-navigate", (event) => {
    if (!event.isMainFrame && event.url !== ARTIFACT_FRAME_URL) event.preventDefault();
  });

  if (RENDERER_URL) {
    const url = RENDERER_URL;
    // The dev server may still be starting; keep retrying until it answers. A subframe that fails
    // (an HTML preview whose navigation was refused) must not reload the app.
    window.webContents.on("did-fail-load", (_event, _code, _description, _url, isMainFrame) => {
      if (isMainFrame) setTimeout(() => void window?.loadURL(url), 500);
    });
    void window.loadURL(url);
  } else {
    void window.loadFile(join(process.resourcesPath, "renderer", "index.html"));
  }
}

ipc.handle(IPC.agentCommand, (_event, command: AgentCommand) => commandAgent(command));
ipc.handle(IPC.filesPick, () => pickFiles(window));
ipc.handle(IPC.filesPickSkill, () => pickSkill(window));
ipc.handle(IPC.filesOpenWorkspace, (_event, dir: unknown) => {
  // Only workspace folders can be opened this way, never files or bundles (opening could run them).
  if (typeof dir !== "string") throw new Error(translator()("app.folderCannotOpen"));
  return openFolder(dir, settings.workspaceFolders);
});
ipc.handle(IPC.filesPickFolder, () => pickFolder(window));
ipc.handle(IPC.filesOpenAgent, () => openAgentFile(window));
ipc.handle(IPC.filesSaveAgent, (_event, suggestedName: unknown, json: unknown) => {
  if (typeof suggestedName !== "string" || typeof json !== "string")
    throw new Error(translator()("app.agentCannotExport"));
  return saveAgentFile(window, suggestedName, json);
});
ipc.handle(
  IPC.filesSaveExport,
  (_event, suggestedName: unknown, format: unknown, content: unknown) => {
    const known = EXPORT_FORMATS.find((candidate) => candidate === format);
    if (typeof suggestedName !== "string" || !known || typeof content !== "string")
      throw new Error(translator()("app.conversationCannotExport"));
    return saveExportFile(window, suggestedName, known, content);
  },
);
ipc.handle(IPC.filesReveal, (_event, path: unknown) => {
  // Only the app's own files (skills, mcp.json) and the workspace can be shown.
  if (typeof path !== "string" || !(isInside(USER_DATA_DIR, path) || isInside(WORKSPACE_DIR, path)))
    throw new Error(translator()("app.locationCannotShow"));
  shell.showItemInFolder(path);
});
ipc.handle(IPC.openExternal, (_event, url: unknown) => {
  if (typeof url !== "string") throw new Error(translator()("app.onlyWebLinks"));
  return openExternal(url);
});

ipc.handle(IPC.shellTakePendingFocus, () => {
  const wasPending = pendingFocus;
  pendingFocus = false;
  return wasPending;
});

// Cmd+W / Ctrl+W with no tab to close: close the window, as the default menu would have.
ipc.handle(IPC.shellCloseWindow, () => window?.close());

ipc.handle(IPC.computerStatus, () => computer.status());
ipc.handle(IPC.computerRequestPermissions, () => computer.requestPermissions());

ipc.handle(IPC.diagnosticsInfo, async () => ({ file: audit.file, size: await audit.bytes() }));
ipc.handle(IPC.diagnosticsExport, async () => {
  const report = await buildReport(audit, {
    facts: {
      Generated: new Date().toISOString(),
      "PP Agent": `${app.getVersion()}${app.isPackaged ? "" : " (development)"}`,
      System: `${process.platform} ${process.arch} (${release()})`,
      Electron: `${process.versions.electron} (Chrome ${process.versions.chrome}, Node ${process.versions.node})`,
      Language: app.getLocale(),
    },
    daemonLog: DAEMON_LOG_FILE,
    daemonLogBytes: DAEMON_LOG_REPORT_BYTES,
    home: homedir(),
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return saveDiagnosticsFile(window, `pp-agent-diagnostics-${stamp}.log`, report);
});
ipc.handle(IPC.diagnosticsReveal, () => shell.showItemInFolder(audit.file));
ipc.handle(IPC.diagnosticsClear, () => audit.clear());
// Fire and forget from the page: whatever arrives is checked, since the page is not trusted with the log.
ipc.on(IPC.diagnosticsReport, (_event, report: unknown) => {
  const { kind, message, stack } = (report ?? {}) as Partial<RendererReport>;
  if ((kind !== "error" && kind !== "unhandledrejection") || typeof message !== "string") return;
  audit.record("renderer_error", {
    reportKind: kind,
    message,
    ...(typeof stack === "string" ? { stack } : {}),
  });
});

ipc.handle(IPC.updatesState, () => updater.state());
ipc.handle(IPC.updatesCheck, () => updater.check(true));
ipc.handle(IPC.updatesDownload, () => updater.download(openExternal));
ipc.handle(IPC.updatesInstall, () =>
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
  // The driver also exits on its own when this process ends and its stdin closes.
  void computer.dispose();
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
  handleArtifactScheme(session.defaultSession, artifactLibPath);
  void startDaemon();
  createWindow();
  applyShellSettings();
  updater.start();
});
