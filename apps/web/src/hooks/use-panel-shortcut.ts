import * as React from "react";
import { DEFAULT_BROWSER_PROFILE_ID, type DesktopBridge } from "@workspace/shared";

import { closeMainTab, newBrowserTab } from "@/lib/workbench-actions";
import { useChatStore } from "@/stores/chat-store";
import { usePanelStore } from "@/stores/panel-store";
import { browserHost, NO_WORKSPACE, tabKey, useWorkbenchStore } from "@/stores/workbench-store";

/** macOS uses Cmd; elsewhere Ctrl. Ctrl+J stays with the terminal on macOS (it is a newline). */
export const IS_MAC = navigator.userAgent.includes("Mac");

/** Cmd+T / Ctrl+T: a new browser tab in the main area, in the default profile. */
function openNewTab(bridge: DesktopBridge) {
  const folder = useChatStore.getState().workspaceDir;
  void newBrowserTab(bridge, folder, DEFAULT_BROWSER_PROFILE_ID);
}

/**
 * Cmd+J / Ctrl+J opens and closes the side panel (the file tree); Cmd+T / Ctrl+T opens a new
 * browser tab. A browser page in the main area has the keyboard to itself, so main reports the
 * shortcuts pressed there. Main also asks for a
 * browser tab to show while the agent uses it: it opens in the main area, unless it is already
 * there.
 */
export function usePanelShortcut(bridge: DesktopBridge) {
  React.useEffect(() => {
    const toggle = () => usePanelStore.getState().toggle();
    function onKeyDown(event: KeyboardEvent) {
      const modifier = IS_MAC ? event.metaKey : event.ctrlKey;
      if (!modifier || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key === "j") {
        event.preventDefault();
        event.stopPropagation();
        toggle();
      } else if (key === "t") {
        // Ctrl+T is "transpose characters" in a shell: the terminal keeps the key.
        const focused = document.activeElement;
        if (!IS_MAC && focused instanceof HTMLElement && focused.closest(".xterm")) return;
        event.preventDefault();
        event.stopPropagation();
        openNewTab(bridge);
      }
    }
    // Capture, so the terminal does not see the key first.
    window.addEventListener("keydown", onKeyDown, true);
    const unsubscribe = bridge.shell.onTogglePanel(toggle);
    const unsubscribeNewTab = bridge.shell.onNewTab(() => openNewTab(bridge));
    const unsubscribeReveal = bridge.browser.onReveal((tabId) => {
      const bench = useWorkbenchStore.getState();
      const scope = useChatStore.getState().workspaceDir ?? NO_WORKSPACE;
      // Already in this main area: it is not brought to the front again, so the person can go back
      // to the chat. A tab of another workspace's main area comes here.
      if (browserHost(bench.byRoot, tabId) !== scope) {
        bench.add(scope, { kind: "browser", id: tabId });
      }
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      unsubscribe();
      unsubscribeNewTab();
      unsubscribeReveal();
    };
  }, [bridge]);
}

/**
 * Cmd+W / Ctrl+W closes the tab in front in the main area's focused group. Main hands the key over
 * (so the default menu does not close the window first); with no such tab showing (the chat is in
 * front), the window closes.
 */
export function useCloseTabShortcut(bridge: DesktopBridge) {
  React.useEffect(
    () =>
      bridge.shell.onCloseTab(() => {
        // Ctrl+W is "delete the last word" in a shell: the terminal gets the key back.
        const focused = document.activeElement;
        if (!IS_MAC && focused instanceof HTMLElement && focused.closest(".xterm")) {
          focused.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "w",
              code: "KeyW",
              keyCode: 87,
              ctrlKey: true,
              bubbles: true,
              cancelable: true,
            }),
          );
          return;
        }
        const scope = useChatStore.getState().workspaceDir ?? NO_WORKSPACE;
        const bench = useWorkbenchStore.getState().byRoot[scope];
        const group = bench?.groups[bench.focused];
        const front = group?.tabs.find((tab) => tabKey(tab) === group.active);
        if (front && front.kind !== "chat") closeMainTab(bridge, scope, front);
        else void bridge.shell.closeWindow();
      }),
    [bridge],
  );
}
