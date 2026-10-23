import type {
  AppSettings,
  Attachment,
  DesktopBridge,
  FetchGatewayModelsInput,
  FetchedGatewayModel,
  GatewayView,
  ModelRef,
  ProviderSummary,
  SaveGatewayInput,
  ThinkingLevel,
} from "@workspace/shared";
import {
  queryOptions,
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";

/** Keys match `SettingsScope`, so `settings_changed` can invalidate `[scope]` directly. */
export const queryKeys = {
  settings: ["settings"] as const,
  providers: ["providers"] as const,
  gateways: ["gateways"] as const,
  models: ["models"] as const,
  tools: ["tools"] as const,
  webSearch: ["web-search"] as const,
  skills: ["skills"] as const,
  skill: (name: string) => ["skill", name] as const,
  mcp: ["mcp"] as const,
  mcpJson: ["mcp-json"] as const,
  sessions: ["sessions"] as const,
  agents: ["agents"] as const,
  workspaces: ["workspaces"] as const,
  agentToolOptions: ["agent-tool-options"] as const,
};

export const settingsQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.settings,
    queryFn: () => bridge.agent.command({ type: "get_settings" }),
  });

/** Built-in providers and gateways, configured first. */
export const providersQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.providers,
    queryFn: () => bridge.agent.command({ type: "list_providers" }),
  });

export const gatewaysQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.gateways,
    queryFn: () => bridge.agent.command({ type: "list_gateways" }),
  });

/** Models of every connected provider. */
export const modelsQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.models,
    queryFn: () => bridge.agent.command({ type: "list_models" }),
  });

/** Saved conversations, newest first. Refetched when the agent reports `sessions_changed`. */
export const sessionsQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.sessions,
    queryFn: () => bridge.agent.command({ type: "list_sessions" }),
  });

/** Agents (profiles), the default one first. */
export const agentsQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.agents,
    queryFn: () => bridge.agent.command({ type: "list_agents" }),
  });

/** Workspaces, the default one first. */
export const workspacesQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.workspaces,
    queryFn: () => bridge.agent.command({ type: "list_workspaces" }),
  });

export function useUpdateSettings(bridge: DesktopBridge) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Pick<AppSettings, "defaultModel" | "shellEnabled" | "language">>) =>
      bridge.agent.command({ type: "update_settings", patch }),
    onSuccess: (settings) => queryClient.setQueryData(queryKeys.settings, settings),
  });
}

/** Provider changes also change the gateway list and the models people can pick. */
function useInvalidateProviders() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      [queryKeys.providers, queryKeys.gateways, queryKeys.models].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
}

/** Mutations of Settings › Models; each refreshes providers, gateways, and models. */
export interface ProviderCommands {
  /** Resolves once the person answered the key prompt; rejects with "Cancelled" when closed. */
  connect: UseMutationResult<ProviderSummary, Error, string>;
  disconnect: UseMutationResult<void, Error, string>;
  saveGateway: UseMutationResult<GatewayView, Error, SaveGatewayInput>;
  deleteGateway: UseMutationResult<void, Error, string>;
  /** Models the gateway lists, with the limits it reports; does not change anything. */
  fetchGatewayModels: UseMutationResult<FetchedGatewayModel[], Error, FetchGatewayModelsInput>;
}

export function useProviderCommands(bridge: DesktopBridge): ProviderCommands {
  const invalidate = useInvalidateProviders();
  const connect = useMutation({
    mutationFn: (providerId: string) =>
      bridge.agent.command({ type: "connect_provider", providerId }),
    onSettled: invalidate,
  });
  const disconnect = useMutation({
    mutationFn: (providerId: string) =>
      bridge.agent.command({ type: "disconnect_provider", providerId }),
    onSettled: invalidate,
  });
  const saveGateway = useMutation({
    mutationFn: (gateway: SaveGatewayInput) =>
      bridge.agent.command({ type: "save_gateway", gateway }),
    onSuccess: invalidate,
  });
  const deleteGateway = useMutation({
    mutationFn: (id: string) => bridge.agent.command({ type: "delete_gateway", id }),
    onSuccess: invalidate,
  });
  const fetchGatewayModels = useMutation({
    mutationFn: (input: FetchGatewayModelsInput) =>
      bridge.agent.command({ type: "fetch_gateway_models", ...input }),
  });
  return { connect, disconnect, saveGateway, deleteGateway, fetchGatewayModels };
}

export function useRespondAuthPrompt(bridge: DesktopBridge) {
  return useMutation({
    mutationFn: (input: { promptId: string; value: string | null }) =>
      bridge.agent.command({ type: "respond_auth_prompt", ...input }),
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
    /** Without a workspace id: in the workspace of the open conversation. */
    mutationFn: (workspaceId?: string) => bridge.agent.command({ type: "new_chat", workspaceId }),
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
  const setModel = useMutation({
    mutationFn: (model: ModelRef) => bridge.agent.command({ type: "set_model", ...model }),
  });
  const setAgent = useMutation({
    mutationFn: (id: string) => bridge.agent.command({ type: "set_agent", id }),
  });
  const setThinkingLevel = useMutation({
    mutationFn: (level: ThinkingLevel) =>
      bridge.agent.command({ type: "set_thinking_level", level }),
  });
  const compact = useMutation({
    mutationFn: () => bridge.agent.command({ type: "compact" }),
  });
  return {
    prompt,
    abort,
    newChat,
    respondApproval,
    openSession,
    renameSession,
    deleteSession,
    setModel,
    setAgent,
    setThinkingLevel,
    compact,
  };
}
