import {
  type AgentEvent,
  type BrowserState,
  type DesktopBridge,
  IPC,
  type TerminalInfo,
  type UpdateState,
} from "@workspace/shared";
import { contextBridge, ipcRenderer, type IpcRendererEvent, webUtils } from "electron";

/**
 * `ipcRenderer.invoke` rejects with "Error invoking remote method '<channel>': Error: <message>".
 * The renderer shows these messages to people, so pass on only the main process's own message.
 */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, ""));
  }
}

/** Subscribes to a channel main pushes on; returns the unsubscribe function. */
function subscribe<A extends unknown[]>(channel: string, listener: (...args: A) => void) {
  const handler = (_event: IpcRendererEvent, ...args: unknown[]) => listener(...(args as A));
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.off(channel, handler);
  };
}

const bridge: DesktopBridge = {
  agent: {
    command: (command) => invoke(IPC.agentCommand, command),
    onEvent(listener) {
      const handler = (_event: IpcRendererEvent, payload: AgentEvent) => listener(payload);
      ipcRenderer.on(IPC.agentEvent, handler);
      return () => {
        ipcRenderer.off(IPC.agentEvent, handler);
      };
    },
  },
  files: {
    pick: () => invoke(IPC.filesPick),
    pickSkill: () => invoke(IPC.filesPickSkill),
    // Sandboxed renderers cannot read `File.path`; webUtils resolves it in the preload.
    pathFor: (file) => webUtils.getPathForFile(file),
    openWorkspace: (dir) => invoke(IPC.filesOpenWorkspace, dir),
    pickFolder: () => invoke(IPC.filesPickFolder),
    openAgentFile: () => invoke(IPC.filesOpenAgent),
    saveAgentFile: (suggestedName, json) => invoke(IPC.filesSaveAgent, suggestedName, json),
    saveExport: (suggestedName, format, content) =>
      invoke(IPC.filesSaveExport, suggestedName, format, content),
    reveal: (path) => invoke(IPC.filesReveal, path),
  },
  updates: {
    state: () => invoke(IPC.updatesState),
    check: () => invoke(IPC.updatesCheck),
    download: () => invoke(IPC.updatesDownload),
    install: () => invoke(IPC.updatesInstall),
    onState(listener) {
      const handler = (_event: IpcRendererEvent, state: UpdateState) => listener(state);
      ipcRenderer.on(IPC.updatesEvent, handler);
      return () => {
        ipcRenderer.off(IPC.updatesEvent, handler);
      };
    },
  },
  openExternal: (url) => invoke(IPC.openExternal, url),
  shell: {
    onFocusComposer(listener) {
      const handler = () => listener();
      ipcRenderer.on(IPC.shellFocusComposer, handler);
      return () => {
        ipcRenderer.off(IPC.shellFocusComposer, handler);
      };
    },
    takePendingFocus: () => invoke(IPC.shellTakePendingFocus),
    onTogglePanel: (listener) => subscribe(IPC.shellTogglePanel, listener),
  },
  terminal: {
    list: () => invoke(IPC.terminalList),
    create: (cwd, size) => invoke(IPC.terminalCreate, cwd, size),
    backlog: (id) => invoke(IPC.terminalBacklog, id),
    write: (id, data) => ipcRenderer.send(IPC.terminalWrite, id, data),
    resize: (id, size) => ipcRenderer.send(IPC.terminalResize, id, size),
    close: (id) => invoke(IPC.terminalClose, id),
    onData: (listener) => subscribe<[string, string, number]>(IPC.terminalData, listener),
    onChanged: (listener) => subscribe<[TerminalInfo[]]>(IPC.terminalChanged, listener),
  },
  workspace: {
    list: (root, dir) => invoke(IPC.workspaceList, root, dir),
    preview: (root, path) => invoke(IPC.workspacePreview, root, path),
    reveal: (root, path) => invoke(IPC.workspaceReveal, root, path),
    attachment: (root, path) => invoke(IPC.workspaceAttachment, root, path),
    watch: (root) => invoke(IPC.workspaceWatch, root),
    onChanged: (listener) => subscribe<[string]>(IPC.workspaceChanged, listener),
  },
  browser: {
    state: () => invoke(IPC.browserState),
    open: (profileId, url) => invoke(IPC.browserOpen, profileId, url),
    close: (id) => invoke(IPC.browserClose, id),
    activate: (id) => invoke(IPC.browserActivate, id),
    navigate: (id, input) => invoke(IPC.browserNavigate, id, input),
    go: (id, action) => invoke(IPC.browserGo, id, action),
    setBounds: (bounds) => ipcRenderer.send(IPC.browserSetBounds, bounds),
    onState: (listener) => subscribe<[BrowserState]>(IPC.browserChanged, listener),
    onReveal: (listener) => subscribe(IPC.browserReveal, listener),
    cookieSources: () => invoke(IPC.browserCookieSources),
    importCookies: (profileId, browser, sourceProfile) =>
      invoke(IPC.browserImportCookies, profileId, browser, sourceProfile),
  },
  computer: {
    status: () => invoke(IPC.computerStatus),
    requestPermissions: () => invoke(IPC.computerRequestPermissions),
  },
};

contextBridge.exposeInMainWorld("ppAgent", bridge);
