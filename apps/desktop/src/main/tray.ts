import { join } from "node:path";
import { app, Menu, nativeImage, Tray } from "electron";
import { translator } from "./i18n.ts";

export interface TrayActions {
  windowShown(): boolean;
  /** Shows the window when hidden, hides it when shown. */
  toggleWindow(): void;
  newChat(): void;
  quit(): void;
}

let tray: Tray | null = null;
let actions: TrayActions | null = null;

/** Tray icons ship in `resources/tray` (extraResources in packaged builds). */
function iconFolder(distDir: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, "tray")
    : join(distDir, "..", "resources", "tray");
}

/** True while the tray icon exists; closing the window then hides it. */
export function trayActive(): boolean {
  return tray !== null;
}

/** Rebuilds the menu, so the Show/Hide label and the language follow the current state. */
export function refreshTray(): void {
  if (!tray || !actions) return;
  const t = translator();
  const current = actions;
  tray.setToolTip(t("shell.tray.tooltip"));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: current.windowShown() ? t("shell.tray.hide") : t("shell.tray.show"),
        click: () => current.toggleWindow(),
      },
      { label: t("shell.tray.newChat"), click: () => current.newChat() },
      { type: "separator" },
      { label: t("shell.tray.quit"), click: () => current.quit() },
    ]),
  );
}

/** Creates or removes the tray icon so it matches the setting. */
export function syncTray(enabled: boolean, next: TrayActions, distDir: string): void {
  actions = next;
  if (!enabled) {
    tray?.destroy();
    tray = null;
    return;
  }
  if (!tray) {
    // macOS picks `trayTemplate.png` / `trayTemplate@2x.png` up as a template image that follows
    // the menu bar's light and dark appearance; other systems use the colored icon.
    const file = process.platform === "darwin" ? "trayTemplate.png" : "tray.png";
    const icon = nativeImage.createFromPath(join(iconFolder(distDir), file));
    tray = new Tray(icon);
    if (process.platform !== "darwin") tray.on("click", () => actions?.toggleWindow());
  }
  refreshTray();
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
