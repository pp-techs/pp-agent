import { isAbsolute, join } from "node:path";
import {
  type AgentCommand,
  type AgentEvent,
  type AgentToMainMessage,
  IPC,
  type MainToAgentMessage,
  type VaultRequest,
} from "@workspace/shared";
import { app, BrowserWindow, ipcMain, shell, type UtilityProcess, utilityProcess } from "electron";
import {
  isInside,
  openAgentFile,
  openFolder,
  pickFiles,
  pickFolder,
  pickSkill,
  saveAgentFile,
} from "./files.ts";
import { initI18n, translator } from "./i18n.ts";
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
let agent: UtilityProcess | null = null;
let nextCommandId = 0;
let quitting = false;
/** Resolves once the legacy provider.json has been migrated; the agent starts after it. */
let migration: Promise<void> | null = null;
const pending = new Map<
  number,
  { resolve: (data: unknown) => void; reject: (error: Error) => void }
>();

function sendToRenderer(event: AgentEvent): void {
  window?.webContents.send(IPC.agentEvent, event);
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

  const child = utilityProcess.fork(join(DIST_DIR, "agent.mjs"), [], {
    serviceName: "PP Agent",
    stdio: "inherit",
  });
  agent = child;

  child.on("message", (message: AgentToMainMessage) => {
    switch (message.kind) {
      case "event":
        sendToRenderer(message.event);
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

ipcMain.handle(IPC.updatesState, () => updater.state());
ipcMain.handle(IPC.updatesCheck, () => updater.check(true));
ipcMain.handle(IPC.updatesDownload, () => updater.download(openExternal));
ipcMain.handle(IPC.updatesInstall, () => updater.install());

app.on("before-quit", () => {
  quitting = true;
  agent?.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// No top-level await: Electron emits `ready` only after the ESM main module finishes evaluating.
void app.whenReady().then(() => {
  void startAgent();
  createWindow();
  updater.start();
});
