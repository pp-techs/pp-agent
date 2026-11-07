import {
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  type WebFrameMain,
} from "electron";

/** `ipcMain.handle`/`ipcMain.on` that answer only the app window's own page. */
export interface TrustedIpc {
  // `never[]` takes handlers of any parameter types; each handler checks its arguments itself.
  handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: never[]) => unknown): void;
  on(channel: string, listener: (event: IpcMainEvent, ...args: never[]) => void): void;
}

/**
 * Whether a message comes from the main frame of the app window, showing the app's own page. Side
 * panel pages and popups have no preload, and the CSP keeps other frames out; this keeps a page that
 * somehow got a bridge (a future preload, an iframe) from reaching main.
 */
export function isTrustedSender(
  frame: WebFrameMain | null,
  window: BrowserWindow | null,
  isAppPage: (url: string) => boolean,
): boolean {
  const contents = window?.webContents;
  if (!frame || !contents || contents.isDestroyed()) return false;
  const main = contents.mainFrame;
  return (
    frame.processId === main.processId && frame.routingId === main.routingId && isAppPage(frame.url)
  );
}

export function createTrustedIpc(
  window: () => BrowserWindow | null,
  isAppPage: (url: string) => boolean,
): TrustedIpc {
  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    isTrustedSender(event.senderFrame, window(), isAppPage);
  return {
    handle(channel, listener) {
      ipcMain.handle(channel, (event, ...args: unknown[]) => {
        if (!trusted(event)) throw new Error("This request did not come from the PP Agent window.");
        // Unchecked on purpose: renderer input, which every handler validates.
        return listener(event, ...(args as never[]));
      });
    },
    on(channel, listener) {
      ipcMain.on(channel, (event, ...args: unknown[]) => {
        if (trusted(event)) listener(event, ...(args as never[]));
      });
    },
  };
}

/**
 * The app's own page: the renderer dev server's origin in development, else the bundled
 * `index.html` (any hash route).
 */
export function appPageMatcher(devServerUrl: string | null, indexFileUrl: string) {
  if (devServerUrl) {
    const origin = new URL(devServerUrl).origin;
    return (url: string) => URL.canParse(url) && new URL(url).origin === origin;
  }
  const index = new URL(indexFileUrl);
  return (url: string) => {
    if (!URL.canParse(url)) return false;
    const page = new URL(url);
    return page.protocol === "file:" && page.pathname === index.pathname;
  };
}
