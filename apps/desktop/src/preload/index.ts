import { type AgentEvent, type DesktopBridge, IPC, type UpdateState } from "@workspace/shared";
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
};

contextBridge.exposeInMainWorld("ppAgent", bridge);
