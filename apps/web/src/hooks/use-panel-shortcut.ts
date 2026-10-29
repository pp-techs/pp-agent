import * as React from "react";
import type { DesktopBridge } from "@workspace/shared";

import { usePanelStore } from "@/stores/panel-store";

/** macOS uses Cmd; elsewhere Ctrl. Ctrl+J stays with the terminal on macOS (it is a newline). */
export const IS_MAC = navigator.userAgent.includes("Mac");

/**
 * Cmd+J / Ctrl+J opens and closes the side panel. A browser page in the panel has the keyboard to
 * itself, so main reports the shortcut pressed there.
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
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      unsubscribe();
    };
  }, [bridge]);
}
