import * as React from "react";
import type { DesktopBridge } from "@workspace/shared";

import { useChatStore } from "@/stores/chat-store";
import { useFileTabsStore } from "@/stores/file-tabs-store";
import { usePanelStore } from "@/stores/panel-store";

/** macOS uses Cmd; elsewhere Ctrl. Ctrl+J stays with the terminal on macOS (it is a newline). */
export const IS_MAC = navigator.userAgent.includes("Mac");

/**
 * Cmd+J / Ctrl+J opens and closes the side panel. A browser page in the panel has the keyboard to
 * itself, so main reports the shortcut pressed there. Main also asks for the browser to show while
 * the agent uses it.
 */
export function usePanelShortcut(bridge: DesktopBridge) {
  React.useEffect(() => {
    const toggle = () => usePanelStore.getState().toggle();
    function onKeyDown(event: KeyboardEvent) {
      const modifier = IS_MAC ? event.metaKey : event.ctrlKey;
      if (!modifier || event.altKey || event.shiftKey || event.key.toLowerCase() !== "j") return;
      event.preventDefault();
      event.stopPropagation();
      toggle();
    }
    // Capture, so the terminal does not see the key first.
    window.addEventListener("keydown", onKeyDown, true);
    const unsubscribe = bridge.shell.onTogglePanel(toggle);
    const unsubscribeReveal = bridge.browser.onReveal(() => {
      const panel = usePanelStore.getState();
      if (!panel.open || panel.tool !== "browser") panel.show("browser");
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      unsubscribe();
      unsubscribeReveal();
    };
  }, [bridge]);
}

/**
 * Cmd+W / Ctrl+W closes the file tab in front in the Files tool. Main hands the key over (so the
 * default menu does not close the window first); with no file tab showing, the window closes.
 */
export function useCloseTabShortcut(bridge: DesktopBridge) {
  React.useEffect(
    () =>
      bridge.shell.onCloseTab(() => {
        const panel = usePanelStore.getState();
        const root = useChatStore.getState().workspaceDir;
        const tabs = useFileTabsStore.getState();
        const active = root ? tabs.byRoot[root]?.active : null;
        if (panel.open && panel.tool === "files" && root && active) tabs.close(root, active);
        else void bridge.shell.closeWindow();
      }),
    [bridge],
  );
}
