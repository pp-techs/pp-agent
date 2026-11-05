import * as React from "react";
import type { DesktopBridge, MemoryChange, SettingsScope } from "@workspace/shared";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";

import { askAuthPrompt, withdrawAuthPrompt } from "@/components/modals/auth-prompt-modal";
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
  background: [queryKeys.serviceStatus, queryKeys.telegramStatus, queryKeys.zaloStatus],
  browserProfiles: [queryKeys.browserProfiles],
  computerApps: [queryKeys.computerApps],
  remoteAccess: [queryKeys.remoteAccess],
};

/** Lines of the "Remembered" toast shown at most; the rest are counted. */
const AUTO_SAVED_LINES = 3;

/** One line per remembered change: the new text, or what was forgotten. */
function describeMemoryChanges(changes: MemoryChange[]): string {
  const lines = changes
    .slice(0, AUTO_SAVED_LINES)
    .map((change) =>
      change.after
        ? change.after.text
        : i18n.t("settings:memory.autoSaved.forgot", { text: change.before?.text ?? "" }),
    );
  const rest = changes.length - lines.length;
  if (rest > 0) lines.push(i18n.t("settings:memory.autoSaved.more", { count: rest }));
  return lines.join("\n");
}

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
          askAuthPrompt(bridge, event.prompt);
          break;
        case "auth_prompt_closed":
          withdrawAuthPrompt(event.promptId);
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
        case "memory_auto_saved": {
          const { passId } = event;
          toast(i18n.t("settings:memory.autoSaved.title"), {
            description: describeMemoryChanges(event.changes),
            classNames: { description: "whitespace-pre-line" },
            action: {
              label: i18n.t("settings:memory.autoSaved.undo"),
              onClick: () => {
                bridge.agent
                  .command({ type: "undo_memory_pass", passId })
                  .then(({ undone }) => {
                    if (undone > 0) toast.success(i18n.t("settings:memory.autoSaved.undone"));
                    else toast.info(i18n.t("settings:memory.autoSaved.nothingUndone"));
                  })
                  .catch((error: unknown) =>
                    toast.error(error instanceof Error ? error.message : String(error)),
                  );
              },
            },
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
