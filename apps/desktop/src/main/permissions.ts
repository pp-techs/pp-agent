import type { BrowserWindow, Session, WebContents } from "electron";

/**
 * Web permissions of the renderer. The app window gets exactly two: recording audio for voice
 * input (never video) and writing plain text to the clipboard for the copy buttons. Everything else
 * (camera, location, notifications, screen capture, …) and every other page is refused.
 */
export function restrictPermissions(session: Session, appWindow: () => BrowserWindow | null): void {
  const isAppWindow = (contents: WebContents | null) =>
    contents !== null && contents === appWindow()?.webContents;

  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (!isAppWindow(contents)) return callback(false);
    if (permission === "clipboard-sanitized-write") return callback(true);
    if (permission === "media") {
      const types = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
      return callback(types.length > 0 && types.every((type) => type === "audio"));
    }
    callback(false);
  });

  session.setPermissionCheckHandler((contents, permission, _origin, details) => {
    if (!isAppWindow(contents)) return false;
    if (permission === "clipboard-sanitized-write") return true;
    if (permission === "media") return "mediaType" in details && details.mediaType === "audio";
    return false;
  });
}
