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

function shellSettingsFrom(value: Record<string, unknown>): ShellSettings {
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

function workspaceFoldersFrom(value: Record<string, unknown>, defaultDir: string): string[] {
  const folders = [resolve(defaultDir)];
  for (const entry of Array.isArray(value.workspaces) ? value.workspaces : []) {
    const dir = (entry as { dir?: unknown } | null)?.dir;
    if (typeof dir === "string" && isAbsolute(dir)) folders.push(resolve(dir));
  }
  return folders;
}

/**
 * What main reads from settings.json, parsed once and kept. The agent process owns the file and
 * writes it before it emits `settings_changed`, so main calls `refresh` after that event (and
 * after it connects to the daemon), never on each IPC call. A missing or malformed file gives the
 * defaults.
 */
export class DesktopSettings {
  private shellValue!: ShellSettings;
  private foldersValue!: string[];

  constructor(
    private readonly file: string,
    /** Folder of the built-in workspace, always allowed. */
    private readonly defaultWorkspaceDir: string,
  ) {
    this.refresh();
  }

  /** Notifications, tray icon and global shortcut. */
  get shell(): ShellSettings {
    return this.shellValue;
  }

  /**
   * Folders of the workspaces in settings.json plus the default one: the only folders the side
   * panel may open a terminal in or list.
   */
  get workspaceFolders(): readonly string[] {
    return this.foldersValue;
  }

  /** Re-reads settings.json. */
  refresh(): void {
    let raw: unknown = null;
    try {
      raw = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      // First start, or the file is being replaced: defaults.
    }
    const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    this.shellValue = shellSettingsFrom(value);
    this.foldersValue = workspaceFoldersFrom(value, this.defaultWorkspaceDir);
  }
}
