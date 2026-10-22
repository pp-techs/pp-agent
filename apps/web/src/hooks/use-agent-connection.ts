import * as React from "react";
import type { DesktopBridge } from "@workspace/shared";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { queryKeys } from "@/lib/queries";
import { useChatStore } from "@/stores/chat-store";

/** Mirrors the agent process into the chat store: live events first, then a snapshot to catch up. */
export function useAgentConnection(bridge: DesktopBridge) {
  const queryClient = useQueryClient();
  React.useEffect(() => {
    const { apply } = useChatStore.getState();
    const unsubscribe = bridge.agent.onEvent((event) => {
      if (event.type === "error") toast.error(event.message);
      if (event.type === "sessions_changed" || event.type === "snapshot")
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      // A new session reconnects MCP servers, so the tool list may change.
      if (event.type === "snapshot")
        void queryClient.invalidateQueries({ queryKey: queryKeys.tools });
      apply(event);
    });
    bridge.agent
      .command({ type: "get_snapshot" })
      .then((snapshot) => apply({ type: "snapshot", snapshot }))
      .catch((error: unknown) => toast.error(String(error)));
    return unsubscribe;
  }, [bridge, queryClient]);
}
