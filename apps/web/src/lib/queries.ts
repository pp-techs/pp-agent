import type { Attachment, DesktopBridge, SaveProviderSettings } from "@workspace/shared";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";

export const queryKeys = {
  settings: ["settings"] as const,
  models: (baseUrl: string, apiKey: string) => ["models", baseUrl, apiKey] as const,
  sessions: ["sessions"] as const,
  tools: ["tools"] as const,
};

export const settingsQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.settings,
    queryFn: () => bridge.settings.get(),
  });

/** Models offered by the gateway. `apiKey` empty means "use the stored key". */
export const modelsQuery = (bridge: DesktopBridge, baseUrl: string, apiKey: string) =>
  queryOptions({
    queryKey: queryKeys.models(baseUrl, apiKey),
    queryFn: () => bridge.settings.listModels({ baseUrl, apiKey: apiKey || undefined }),
    staleTime: 5 * 60_000,
    retry: false,
  });

/** Saved conversations, newest first. Refetched when the agent reports `sessions_changed`. */
export const sessionsQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.sessions,
    queryFn: () => bridge.agent.command({ type: "list_sessions" }),
  });

/** Tools the agent can use, including those of connected MCP servers. */
export const toolsQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.tools,
    queryFn: () => bridge.agent.command({ type: "list_tools" }),
  });

export function useSaveSettings(bridge: DesktopBridge) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: SaveProviderSettings) => bridge.settings.save(settings),
    onSuccess: (view) => queryClient.setQueryData(queryKeys.settings, view),
  });
}

/** Agent commands are fire-and-forget from the UI's view; state changes arrive as events. */
export function useAgentCommands(bridge: DesktopBridge) {
  const prompt = useMutation({
    mutationFn: (input: { text: string; attachments: Attachment[] }) =>
      bridge.agent.command({ type: "prompt", ...input }),
  });
  const abort = useMutation({
    mutationFn: () => bridge.agent.command({ type: "abort" }),
  });
  const newChat = useMutation({
    mutationFn: () => bridge.agent.command({ type: "new_chat" }),
  });
  const respondApproval = useMutation({
    mutationFn: (input: { requestId: string; approved: boolean }) =>
      bridge.agent.command({ type: "respond_approval", ...input }),
  });
  const openSession = useMutation({
    mutationFn: (path: string) => bridge.agent.command({ type: "open_session", path }),
  });
  const renameSession = useMutation({
    mutationFn: (input: { path: string; name: string }) =>
      bridge.agent.command({ type: "rename_session", ...input }),
  });
  const deleteSession = useMutation({
    mutationFn: (path: string) => bridge.agent.command({ type: "delete_session", path }),
  });
  return { prompt, abort, newChat, respondApproval, openSession, renameSession, deleteSession };
}
