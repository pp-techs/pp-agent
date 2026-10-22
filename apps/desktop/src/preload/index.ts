import { type AgentEvent, type DesktopBridge, IPC } from "@workspace/shared";
import { contextBridge, ipcRenderer, type IpcRendererEvent, webUtils } from "electron";

const bridge: DesktopBridge = {
  agent: {
    command: (command) => ipcRenderer.invoke(IPC.agentCommand, command),
    onEvent(listener) {
      const handler = (_event: IpcRendererEvent, payload: AgentEvent) => listener(payload);
      ipcRenderer.on(IPC.agentEvent, handler);
      return () => {
        ipcRenderer.off(IPC.agentEvent, handler);
      };
    },
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    save: (settings) => ipcRenderer.invoke(IPC.settingsSave, settings),
    listModels: (request) => ipcRenderer.invoke(IPC.settingsListModels, request),
  },
  files: {
    pick: () => ipcRenderer.invoke(IPC.filesPick),
    // Sandboxed renderers cannot read `File.path`; webUtils resolves it in the preload.
    pathFor: (file) => webUtils.getPathForFile(file),
    openWorkspace: () => ipcRenderer.invoke(IPC.filesOpenWorkspace),
  },
};

contextBridge.exposeInMainWorld("ppAgent", bridge);
