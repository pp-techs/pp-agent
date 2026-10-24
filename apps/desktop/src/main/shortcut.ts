import { globalShortcut } from "electron";

let registered: string | null = null;
/** Accelerator that could not be registered; not retried until the setting changes. */
let failed: string | null = null;

export type ShortcutResult = "ok" | "failed" | "unchanged";

/**
 * Makes the global shortcut match the settings: registers `accelerator` when enabled, replaces a
 * previous one, and unregisters it when disabled. Never throws; a shortcut another app already
 * holds, or one the system refuses, gives "failed".
 */
export function syncShortcut(
  enabled: boolean,
  accelerator: string,
  onFire: () => void,
): ShortcutResult {
  if (!enabled) {
    if (registered) globalShortcut.unregister(registered);
    registered = null;
    failed = null;
    return "unchanged";
  }
  if (accelerator === registered || accelerator === failed) return "unchanged";
  // The old shortcut goes first: after a failed change nothing keeps firing under the old keys.
  if (registered) globalShortcut.unregister(registered);
  registered = null;
  try {
    if (!globalShortcut.register(accelerator, onFire)) throw new Error("already in use");
  } catch (error) {
    console.error(`Global shortcut ${accelerator} could not be registered:`, error);
    failed = accelerator;
    return "failed";
  }
  registered = accelerator;
  failed = null;
  return "ok";
}

export function releaseShortcut(): void {
  globalShortcut.unregisterAll();
  registered = null;
}
