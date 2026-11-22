import type { DesktopBridge } from "@workspace/shared";
import { toast } from "sonner";

import { focusAddressOnShow } from "@/lib/browser-tabs";
import { useChatStore } from "@/stores/chat-store";
import { useRunStore } from "@/stores/run-store";
import { type CenterTab, NO_SESSION, tabKey, useWorkbenchStore } from "@/stores/workbench-store";

function showError(error: unknown) {
  toast.error(error instanceof Error ? error.message : String(error));
}

/** The open conversation: its session file, which keys its main area and owns its tabs. */
export function currentSession(): string {
  return useChatStore.getState().sessionPath ?? NO_SESSION;
}

/** Opens a workspace file as a tab of the open conversation's main area, or shows its tab if it is there. */
export function openFile(root: string, path: string): void {
  useWorkbenchStore.getState().add(currentSession(), { kind: "file", root, path });
}

/** Shows the Run tab of the open conversation's main area (its runs as a graph and a timeline). */
export function openRunTab(): void {
  useWorkbenchStore.getState().add(currentSession(), { kind: "run" });
}

/** Terminals and browser tabs being closed: the main area does not take them back meanwhile. */
export const closingTabs = new Set<string>();

/** Closes a main-area tab; a terminal's shell ends and a browser tab closes. */
export function closeMainTab(bridge: DesktopBridge, session: string, tab: CenterTab): void {
  useWorkbenchStore.getState().close(session, tabKey(tab));
  if (tab.kind !== "terminal" && tab.kind !== "browser") return;
  closingTabs.add(tab.id);
  const closing =
    tab.kind === "terminal" ? bridge.terminal.close(tab.id) : bridge.browser.close(tab.id);
  closing.catch(showError).finally(() => closingTabs.delete(tab.id));
}

/** Starts a shell in the workspace folder and shows it as a tab of the conversation's main area. */
export async function newTerminal(
  bridge: DesktopBridge,
  session: string,
  root: string,
): Promise<void> {
  try {
    const created = await bridge.terminal.create(root, { cols: 80, rows: 24 }, session);
    useWorkbenchStore.getState().add(session, { kind: "terminal", id: created.id });
  } catch (error) {
    showError(error);
  }
}

/**
 * Opens a browser tab in a profile and shows it in the conversation's main area. A tab opened
 * without an address puts the keyboard in its address bar.
 */
export async function newBrowserTab(
  bridge: DesktopBridge,
  session: string,
  profileId: string,
  url?: string,
): Promise<void> {
  try {
    const tab = await bridge.browser.open(profileId, session, url);
    if (!url) focusAddressOnShow(tab.id);
    useWorkbenchStore.getState().add(session, { kind: "browser", id: tab.id });
  } catch (error) {
    showError(error);
  }
}

/** A conversation was deleted: its terminals end, its browser tabs close, and its main area goes. */
export async function closeSessionTabs(bridge: DesktopBridge, session: string): Promise<void> {
  useWorkbenchStore.getState().forgetSession(session);
  useRunStore.getState().forgetSession(session);
  try {
    const [terminals, browser] = await Promise.all([
      bridge.terminal.list(),
      bridge.browser.state(),
    ]);
    await Promise.all([
      ...terminals
        .filter((terminal) => terminal.session === session)
        .map((terminal) => bridge.terminal.close(terminal.id)),
      ...browser.tabs
        .filter((tab) => tab.session === session)
        .map((tab) => bridge.browser.close(tab.id)),
    ]);
  } catch (error) {
    showError(error);
  }
}
