import * as React from "react";
import type { BrowserState, DesktopBridge, TerminalInfo } from "@workspace/shared";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { queryKeys } from "@/lib/queries";

function showError(error: unknown) {
  toast.error(error instanceof Error ? error.message : String(error));
}

/** Browser tabs and the active tab, kept in sync with the main process; null until known. */
export function useBrowserState(bridge: DesktopBridge): BrowserState | null {
  const [state, setState] = React.useState<BrowserState | null>(null);
  React.useEffect(() => {
    const unsubscribe = bridge.browser.onState(setState);
    bridge.browser.state().then(setState).catch(showError);
    return unsubscribe;
  }, [bridge]);
  return state;
}

/** All terminals, kept in sync with the main process; null until known. */
export function useTerminals(bridge: DesktopBridge): TerminalInfo[] | null {
  const [terminals, setTerminals] = React.useState<TerminalInfo[] | null>(null);
  React.useEffect(() => {
    const unsubscribe = bridge.terminal.onChanged(setTerminals);
    bridge.terminal
      .list()
      .then(setTerminals)
      .catch((error: Error) => toast.error(error.message));
    return unsubscribe;
  }, [bridge]);
  return terminals;
}

/** How many views follow the workspace now: the watch ends with the last one. */
let watchers = 0;

/**
 * Follows changes in a workspace folder while the calling view is mounted, so file trees and
 * previews refresh. The window has one watch, shared by every view that asks for it.
 */
export function useWorkspaceWatch(bridge: DesktopBridge, root: string) {
  const queryClient = useQueryClient();
  React.useEffect(() => {
    const refresh = (changed: string) => {
      if (changed !== root) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceFiles(changed) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.filePreviews(changed) });
    };
    const unsubscribe = bridge.workspace.onChanged(refresh);
    watchers += 1;
    bridge.workspace.watch(root).catch((error: Error) => toast.error(error.message));
    return () => {
      unsubscribe();
      watchers -= 1;
      if (watchers === 0) void bridge.workspace.watch(null);
    };
  }, [bridge, root, queryClient]);
}
