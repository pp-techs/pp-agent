import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { DEFAULT_SHORTCUT, isValidAccelerator } from "@workspace/shared";

/** The settings the main process acts on: notifications, tray icon, and global shortcut. */
export interface ShellSettings {
  notifications: boolean;
  tray: boolean;
  shortcutEnabled: boolean;
  shortcut: string;
}

/**
 * Reads them from settings.json. The agent process owns the file and writes it before it emits
 * `settings_changed`, so main re-reads after that event (same approach as the language in
 * `i18n.ts`). A missing or malformed file gives the defaults.
 */
export function readShellSettings(file: string): ShellSettings {
  let raw: unknown = null;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // First start, or the file is being replaced: defaults.
  }
  const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    notifications: value.notifications !== false,
    tray: value.tray === true,
    shortcutEnabled: value.shortcutEnabled === true,
    shortcut:
      typeof value.shortcut === "string" && isValidAccelerator(value.shortcut)
        ? value.shortcut
        : DEFAULT_SHORTCUT,
  };
}

/**
 * Folders of the workspaces in settings.json plus the default one: the only folders the side panel
 * may open a terminal in or list. Read on each call, like `readShellSettings`.
 */
export function readWorkspaceFolders(file: string, defaultDir: string): string[] {
  let raw: unknown = null;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // First start: only the default folder.
  }
  const workspaces = (raw as { workspaces?: unknown } | null)?.workspaces;
  const folders = [resolve(defaultDir)];
  for (const entry of Array.isArray(workspaces) ? workspaces : []) {
    const dir = (entry as { dir?: unknown } | null)?.dir;
    if (typeof dir === "string" && isAbsolute(dir)) folders.push(resolve(dir));
  }
  return folders;
}
