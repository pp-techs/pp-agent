import * as React from "react";
import { DEFAULT_BROWSER_PROFILE_ID, type DesktopBridge } from "@workspace/shared";

import { closeMainTab, currentSession, newBrowserTab } from "@/lib/workbench-actions";
import { usePanelStore } from "@/stores/panel-store";
import { tabKey, useWorkbenchStore } from "@/stores/workbench-store";

/** macOS uses Cmd; elsewhere Ctrl. Ctrl+J stays with the terminal on macOS (it is a newline). */
export const IS_MAC = navigator.userAgent.includes("Mac");

/** Cmd+T / Ctrl+T: a new browser tab in the open conversation's main area, in the default profile. */
function openNewTab(bridge: DesktopBridge) {
  void newBrowserTab(bridge, currentSession(), DEFAULT_BROWSER_PROFILE_ID);
}

/**
 * Cmd+J / Ctrl+J opens and closes the side panel (the file tree); Cmd+T / Ctrl+T opens a new
 * browser tab. A browser page in the main area has the keyboard to itself, so main reports the
 * shortcuts pressed there.
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
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      unsubscribe();
      unsubscribeNewTab();
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
        const scope = currentSession();
        const bench = useWorkbenchStore.getState().bySession[scope];
        const group = bench?.groups[bench.focused];
        const front = group?.tabs.find((tab) => tabKey(tab) === group.active);
        if (front && front.kind !== "chat") closeMainTab(bridge, scope, front);
        else void bridge.shell.closeWindow();
      }),
    [bridge],
  );
}
