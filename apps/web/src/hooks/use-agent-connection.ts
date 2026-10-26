import * as React from "react";
import type { DesktopBridge, SettingsScope } from "@workspace/shared";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";

import { useAuthPromptStore } from "@/components/modals/auth-prompt-modal";
import { i18n } from "@/lib/i18n";
import { queryKeys } from "@/lib/queries";
import { useChatStore } from "@/stores/chat-store";
import { focusComposer } from "@/lib/slash-commands";

/** Queries to refetch per changed scope; some scopes feed more than one query. */
const SCOPE_KEYS: Record<SettingsScope, QueryKey[]> = {
  settings: [queryKeys.settings],
  // A key added or removed in Models decides whether voice input is ready.
  providers: [queryKeys.providers, queryKeys.gateways, queryKeys.voice],
  models: [queryKeys.models],
  tools: [queryKeys.tools, queryKeys.agentToolOptions],
  // Prefix of every ["skill", name] query.
  skills: [queryKeys.skills, ["skill"]],
  mcp: [queryKeys.mcp, queryKeys.mcpJson],
  agents: [queryKeys.agents, queryKeys.agentToolOptions],
  workspaces: [queryKeys.workspaces, queryKeys.agents],
  sessions: [queryKeys.sessions],
  memory: [queryKeys.memory],
  scheduledTasks: [queryKeys.scheduledTasks],
  voice: [queryKeys.voice],
  background: [queryKeys.serviceStatus, queryKeys.telegramStatus],
};

/** Mirrors the agent process into the chat store: live events first, then a snapshot to catch up. */
export function useAgentConnection(bridge: DesktopBridge) {
  const queryClient = useQueryClient();
  React.useEffect(() => {
    const { apply } = useChatStore.getState();
    const invalidate = (queryKey: QueryKey) => void queryClient.invalidateQueries({ queryKey });
    const unsubscribe = bridge.agent.onEvent((event) => {
      switch (event.type) {
        case "error":
          toast.error(event.message);
          break;
        case "sessions_changed":
          invalidate(queryKeys.sessions);
          break;
        case "snapshot":
          invalidate(queryKeys.sessions);
          // A new session reconnects MCP servers, so the tool list may change.
          invalidate(queryKeys.tools);
          break;
        case "settings_changed":
          for (const scope of event.scopes) SCOPE_KEYS[scope].forEach(invalidate);
          break;
        case "auth_prompt":
          useAuthPromptStore.getState().push(event.prompt);
          break;
        case "auth_prompt_closed":
          useAuthPromptStore.getState().remove(event.promptId);
          break;
        case "auth_info": {
          const { url } = event;
          toast(event.flowTitle, {
            description: event.message,
            action: url
              ? {
                  label: i18n.t("common:actions.open"),
                  onClick: () => {
                    bridge.openExternal(url).catch((error: unknown) => toast.error(String(error)));
                  },
                }
              : undefined,
          });
          break;
        }
      }
      apply(event);
    });
    bridge.agent
      .command({ type: "get_snapshot" })
      .then((snapshot) => apply({ type: "snapshot", snapshot }))
      .catch((error: unknown) => toast.error(String(error)));
    // The global shortcut brings the window forward; the message box then takes the cursor.
    const unsubscribeShell = bridge.shell.onFocusComposer(focusComposer);
    // The shortcut may have created the window, so the event came before this listener.
    bridge.shell
      .takePendingFocus()
      .then((pending) => {
        if (pending) focusComposer();
      })
      .catch(() => undefined);
    return () => {
      unsubscribe();
      unsubscribeShell();
    };
  }, [bridge, queryClient]);
}
