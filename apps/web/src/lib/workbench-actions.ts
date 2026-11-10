import type { DesktopBridge } from "@workspace/shared";
import { toast } from "sonner";

import { focusAddressOnShow } from "@/lib/browser-tabs";
import { type CenterTab, NO_WORKSPACE, tabKey, useWorkbenchStore } from "@/stores/workbench-store";

function showError(error: unknown) {
  toast.error(error instanceof Error ? error.message : String(error));
}

/** Opens a workspace file as a tab of the main area, or shows its tab if it is there. */
export function openFile(root: string, path: string): void {
  useWorkbenchStore.getState().add(root, { kind: "file", path });
}

/** Terminals and browser tabs being closed: the main area does not take them back meanwhile. */
export const closingTabs = new Set<string>();

/** Closes a main-area tab; a terminal's shell ends and a browser tab closes. */
export function closeMainTab(bridge: DesktopBridge, root: string, tab: CenterTab): void {
  useWorkbenchStore.getState().close(root, tabKey(tab));
  if (tab.kind !== "terminal" && tab.kind !== "browser") return;
  closingTabs.add(tab.id);
  const closing =
    tab.kind === "terminal" ? bridge.terminal.close(tab.id) : bridge.browser.close(tab.id);
  closing.catch(showError).finally(() => closingTabs.delete(tab.id));
}

/** Starts a shell in the workspace folder and shows it as a tab of the main area. */
export async function newTerminal(bridge: DesktopBridge, root: string): Promise<void> {
  try {
    const created = await bridge.terminal.create(root, { cols: 80, rows: 24 });
    useWorkbenchStore.getState().add(root, { kind: "terminal", id: created.id });
  } catch (error) {
    showError(error);
  }
}

/**
 * Opens a browser tab in a profile and shows it in the main area (of the workspace, or of a
 * conversation without one). A tab opened without an address puts the keyboard in its address bar.
 */
export async function newBrowserTab(
  bridge: DesktopBridge,
  root: string | null,
  profileId: string,
  url?: string,
): Promise<void> {
  try {
    const tab = await bridge.browser.open(profileId, url);
    if (!url) focusAddressOnShow(tab.id);
    useWorkbenchStore.getState().add(root ?? NO_WORKSPACE, { kind: "browser", id: tab.id });
  } catch (error) {
    showError(error);
  }
}
