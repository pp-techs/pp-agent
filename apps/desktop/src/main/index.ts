import { join } from "node:path";
import {
  type AgentCommand,
  type AgentEvent,
  type AgentToMainMessage,
  IPC,
  type ListModelsRequest,
  type MainToAgentMessage,
  type ProviderConfig,
  type SaveProviderSettings,
} from "@workspace/shared";
import { app, BrowserWindow, ipcMain, shell, type UtilityProcess, utilityProcess } from "electron";
import { pickFiles } from "./files.ts";
import { getProviderConfig, getSettingsView, listModels, saveSettings } from "./settings.ts";

const DIST_DIR = import.meta.dirname;
/** Unpackaged runs load the renderer dev server (`vp dev` in apps/web); packaged builds load bundled files. */
const RENDERER_URL = app.isPackaged
  ? null
  : (process.env.ELECTRON_RENDERER_URL ?? "http://localhost:47821");
const RESTART_DELAY_MS = 1_000;
/** Folder the agent reads and writes; attachments are copied here too. */
const WORKSPACE_DIR = join(app.getPath("documents"), "PP Agent");

let window: BrowserWindow | null = null;
let agent: UtilityProcess | null = null;
let nextCommandId = 0;
let quitting = false;
const pending = new Map<
  number,
  { resolve: (data: unknown) => void; reject: (error: Error) => void }
>();

function sendToRenderer(event: AgentEvent): void {
  window?.webContents.send(IPC.agentEvent, event);
}

function postToAgent(message: MainToAgentMessage): void {
  if (!agent) throw new Error("The agent is not running.");
  agent.postMessage(message);
}

async function startAgent(): Promise<void> {
  // Resolve the key before forking so `init` is the first message the agent receives.
  let provider: ProviderConfig | null = null;
  try {
    provider = await getProviderConfig();
  } catch {
    sendToRenderer({
      type: "error",
      message: "The saved API key could not be read. Enter it again in Settings.",
    });
  }

  const child = utilityProcess.fork(join(DIST_DIR, "agent.mjs"), [], {
    serviceName: "PP Agent",
    stdio: "inherit",
  });
  agent = child;

  child.on("message", (message: AgentToMainMessage) => {
    if (message.kind === "event") {
      sendToRenderer(message.event);
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.ok) request.resolve(message.data);
    else request.reject(new Error(message.error));
  });

  child.on("exit", (code) => {
    if (agent !== child) return;
    agent = null;
    for (const request of pending.values())
      request.reject(new Error("The agent stopped unexpectedly."));
    pending.clear();
    if (quitting) return;
    sendToRenderer({
      type: "error",
      message: `The agent stopped (exit code ${code}). Restarting…`,
    });
    sendToRenderer({ type: "status", status: "starting" });
    setTimeout(() => void startAgent(), RESTART_DELAY_MS);
  });

  const userData = app.getPath("userData");
  postToAgent({
    kind: "init",
    paths: {
      workspaceDir: WORKSPACE_DIR,
      agentDir: join(userData, "agent"),
      sessionDir: join(userData, "sessions"),
    },
    provider,
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
ipcMain.handle(IPC.settingsGet, () => getSettingsView());
ipcMain.handle(IPC.settingsListModels, (_event, request: ListModelsRequest) => listModels(request));
ipcMain.handle(IPC.filesPick, () => pickFiles(window));
ipcMain.handle(IPC.filesOpenWorkspace, async () => {
  const error = await shell.openPath(WORKSPACE_DIR);
  if (error) throw new Error(error);
});
ipcMain.handle(IPC.settingsSave, async (_event, input: SaveProviderSettings) => {
  const view = await saveSettings(input);
  const provider = await getProviderConfig();
  if (provider) postToAgent({ kind: "configure", provider });
  return view;
});

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
});
