import type {
  DesktopBridge,
  McpServerSettings,
  SaveAgentInput,
  SaveScheduledTaskInput,
  SaveSkillInput,
  SaveTelegramInput,
  SaveWebSearchInput,
  SaveWorkspaceInput,
  SaveZaloInput,
  SearchProviderId,
  TelegramStatus,
  ToolPolicy,
  ToolSummary,
  VoiceModelPreset,
  VoiceSettings,
  ZaloStatus,
} from "@workspace/shared";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { queryKeys } from "@/lib/queries";

function showError(error: Error) {
  toast.error(error.message);
}

/** Saved notes (newest first) and the global memory switch. */
export const memoryQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.memory,
    queryFn: () => bridge.agent.command({ type: "get_memory" }),
  });

/** Mutations of Settings › Memory; the agent also reports changes with `settings_changed`. */
export function useMemoryCommands(bridge: DesktopBridge) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.memory });
  const setEnabled = useMutation({
    mutationFn: (enabled: boolean) => bridge.agent.command({ type: "set_memory_enabled", enabled }),
    onSuccess: (view) => queryClient.setQueryData(queryKeys.memory, view),
    onError: showError,
  });
  const save = useMutation({
    mutationFn: (input: {
      id?: string;
      text: string;
      tag: string | null;
      workspaceId: string | null;
    }) => bridge.agent.command({ type: "save_memory_entry", ...input }),
    onSuccess: invalidate,
    onError: showError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => bridge.agent.command({ type: "delete_memory_entry", id }),
    onSuccess: invalidate,
    onError: showError,
  });
  const clear = useMutation({
    mutationFn: () => bridge.agent.command({ type: "clear_memory" }),
    onSuccess: invalidate,
    onError: showError,
  });
  return { setEnabled, save, remove, clear };
}

/** Scheduled tasks with their running state and next run; the agent reports changes. */
export const scheduledTasksQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.scheduledTasks,
    queryFn: () => bridge.agent.command({ type: "list_scheduled_tasks" }),
  });

/** Mutations of Settings › Scheduled tasks; each refetches the list. */
export function useScheduledTaskCommands(bridge: DesktopBridge) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.scheduledTasks });
  const save = useMutation({
    mutationFn: (task: SaveScheduledTaskInput) =>
      bridge.agent.command({ type: "save_scheduled_task", task }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => bridge.agent.command({ type: "delete_scheduled_task", id }),
    onSuccess: invalidate,
    onError: showError,
  });
  const setEnabled = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      bridge.agent.command({ type: "set_scheduled_task_enabled", ...input }),
    onSuccess: invalidate,
    onError: showError,
  });
  const run = useMutation({
    mutationFn: (id: string) => bridge.agent.command({ type: "run_scheduled_task", id }),
    onSuccess: invalidate,
    onError: showError,
  });
  return { save, remove, setEnabled, run };
}

/** The voice input setting, the providers that can transcribe, and whether it is ready to use. */
export const voiceQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.voice,
    queryFn: () => bridge.agent.command({ type: "get_voice" }),
  });

export function useSaveVoice(bridge: DesktopBridge) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: VoiceSettings) => bridge.agent.command({ type: "save_voice", config }),
    onSuccess: (view) => queryClient.setQueryData(queryKeys.voice, view),
    onError: showError,
  });
}

/** Downloads a local whisper model; the answer refreshes the voice view (the model is there). */
export function useInstallVoiceModel(bridge: DesktopBridge) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (model: VoiceModelPreset) =>
      bridge.agent.command({ type: "install_voice_model", model }),
    onSuccess: (view) => queryClient.setQueryData(queryKeys.voice, view),
    onError: showError,
  });
}

/** Whether the agent is registered to run in the background (at login, without the window). */
export const serviceStatusQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.serviceStatus,
    queryFn: () => bridge.agent.command({ type: "get_service_status" }),
  });

/** Telegram connection, bot, paired person and the open pairing code, if any. */
export const telegramStatusQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.telegramStatus,
    queryFn: () => bridge.agent.command({ type: "get_telegram_status" }),
  });

/** Zalo connection, bot, paired person and the open pairing code, if any. */
export const zaloStatusQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.zaloStatus,
    queryFn: () => bridge.agent.command({ type: "get_zalo_status" }),
  });

/** Mutations of Settings › Background; each stores the status it returns. */
export function useBackgroundCommands(bridge: DesktopBridge) {
  const queryClient = useQueryClient();
  const setInstalled = useMutation({
    mutationFn: (installed: boolean) =>
      bridge.agent.command({ type: "set_service_installed", installed }),
    onSuccess: (status) => queryClient.setQueryData(queryKeys.serviceStatus, status),
    onError: showError,
  });
  const telegramDone = (status: TelegramStatus) =>
    queryClient.setQueryData(queryKeys.telegramStatus, status);
  const saveTelegram = useMutation({
    mutationFn: (config: SaveTelegramInput) =>
      bridge.agent.command({ type: "save_telegram", config }),
    onSuccess: telegramDone,
    onError: showError,
  });
  const startPairing = useMutation({
    mutationFn: () => bridge.agent.command({ type: "start_telegram_pairing" }),
    onSuccess: telegramDone,
    onError: showError,
  });
  const forgetTelegram = useMutation({
    mutationFn: () => bridge.agent.command({ type: "forget_telegram" }),
    onSuccess: telegramDone,
    onError: showError,
  });
  const zaloDone = (status: ZaloStatus) => queryClient.setQueryData(queryKeys.zaloStatus, status);
  const saveZalo = useMutation({
    mutationFn: (config: SaveZaloInput) => bridge.agent.command({ type: "save_zalo", config }),
    onSuccess: zaloDone,
    onError: showError,
  });
  const startZaloPairing = useMutation({
    mutationFn: () => bridge.agent.command({ type: "start_zalo_pairing" }),
    onSuccess: zaloDone,
    onError: showError,
  });
  const forgetZalo = useMutation({
    mutationFn: () => bridge.agent.command({ type: "forget_zalo" }),
    onSuccess: zaloDone,
    onError: showError,
  });
  return {
    setInstalled,
    saveTelegram,
    startPairing,
    forgetTelegram,
    saveZalo,
    startZaloPairing,
    forgetZalo,
  };
}

/** Tools the agent can use, including those of connected MCP servers. */
export const toolsQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.tools,
    queryFn: () => bridge.agent.command({ type: "list_tools" }),
  });

export const skillsQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.skills,
    queryFn: () => bridge.agent.command({ type: "list_skills" }),
  });

/** Skills in the workspace folder's `.agents/skills`; keyed by folder so each workspace has its own. */
export const workspaceSkillsQuery = (bridge: DesktopBridge, workspaceDir: string | null) =>
  queryOptions({
    queryKey: [...queryKeys.skills, "workspace", workspaceDir] as const,
    queryFn: () => bridge.agent.command({ type: "list_workspace_skills" }),
  });

export const skillQuery = (bridge: DesktopBridge, name: string) =>
  queryOptions({
    queryKey: queryKeys.skill(name),
    queryFn: () => bridge.agent.command({ type: "get_skill", name }),
  });

/** Waits for servers to finish connecting, so it can take a few seconds. */
export const mcpQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.mcp,
    queryFn: () => bridge.agent.command({ type: "list_mcp_servers" }),
    retry: false,
  });

export const mcpJsonQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.mcpJson,
    queryFn: () => bridge.agent.command({ type: "get_mcp_json" }),
    // Always start the editor from the file on disk.
    staleTime: 0,
    gcTime: 0,
  });

// ---------------------------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------------------------

export function useSetShellEnabled(bridge: DesktopBridge) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (shellEnabled: boolean) =>
      bridge.agent.command({ type: "update_settings", patch: { shellEnabled } }),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.settings, settings);
      void queryClient.invalidateQueries({ queryKey: queryKeys.tools });
    },
    onError: showError,
  });
}

export function useSetYoloMode(bridge: DesktopBridge) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (yoloMode: boolean) =>
      bridge.agent.command({ type: "update_settings", patch: { yoloMode } }),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.settings, settings);
      void queryClient.invalidateQueries({ queryKey: queryKeys.tools });
    },
    onError: showError,
  });
}

export function useSetToolPolicy(bridge: DesktopBridge) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; policy: ToolPolicy }) =>
      bridge.agent.command({ type: "set_tool_policy", ...input }),
    onMutate: async ({ name, policy }) => {
      // Show the new choice right away; the effective state comes back with the refetch.
      await queryClient.cancelQueries({ queryKey: queryKeys.tools });
      const previous = queryClient.getQueryData<ToolSummary[]>(queryKeys.tools);
      queryClient.setQueryData<ToolSummary[]>(queryKeys.tools, (tools) =>
        tools?.map((tool) => (tool.name === name ? { ...tool, policy } : tool)),
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.tools, context.previous);
      showError(error);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.tools }),
  });
}

// ---------------------------------------------------------------------------------------------
// Web search
// ---------------------------------------------------------------------------------------------

export const webSearchQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.webSearch,
    queryFn: () => bridge.agent.command({ type: "list_web_search" }),
  });

export function useSaveWebSearch(bridge: DesktopBridge) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: SaveWebSearchInput) =>
      bridge.agent.command({ type: "save_web_search", config }),
    onSuccess: (view) => queryClient.setQueryData(queryKeys.webSearch, view),
    onError: showError,
  });
}

export function useTestWebSearch(bridge: DesktopBridge) {
  return useMutation({
    mutationFn: (provider: SearchProviderId) =>
      bridge.agent.command({ type: "test_web_search", provider }),
    onError: showError,
  });
}

// ---------------------------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------------------------

function useInvalidateSkills() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.skills }),
      queryClient.invalidateQueries({ queryKey: ["skill"] }),
    ]);
}

export function useSetSkillEnabled(bridge: DesktopBridge) {
  const invalidate = useInvalidateSkills();
  return useMutation({
    mutationFn: (input: { name: string; enabled: boolean }) =>
      bridge.agent.command({ type: "set_skill_enabled", ...input }),
    onError: showError,
    onSettled: invalidate,
  });
}

export function useSaveSkill(bridge: DesktopBridge) {
  const invalidate = useInvalidateSkills();
  return useMutation({
    mutationFn: (skill: SaveSkillInput) => bridge.agent.command({ type: "save_skill", skill }),
    onSuccess: invalidate,
    onError: showError,
  });
}

export function useDeleteSkill(bridge: DesktopBridge) {
  const invalidate = useInvalidateSkills();
  return useMutation({
    mutationFn: (name: string) => bridge.agent.command({ type: "delete_skill", name }),
    onSuccess: invalidate,
    onError: showError,
  });
}

export function useImportSkill(bridge: DesktopBridge) {
  const invalidate = useInvalidateSkills();
  return useMutation({
    mutationFn: (path: string) => bridge.agent.command({ type: "import_skill", path }),
    onSuccess: invalidate,
    onError: showError,
  });
}

// ---------------------------------------------------------------------------------------------
// MCP servers
// ---------------------------------------------------------------------------------------------

function useInvalidateMcp() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.mcp }),
      queryClient.invalidateQueries({ queryKey: queryKeys.mcpJson }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tools }),
    ]);
}

export function useSaveMcpServer(bridge: DesktopBridge) {
  const invalidate = useInvalidateMcp();
  return useMutation({
    mutationFn: (input: { originalName?: string; server: McpServerSettings }) =>
      bridge.agent.command({ type: "save_mcp_server", ...input }),
    onError: showError,
    onSettled: invalidate,
  });
}

export function useDeleteMcpServer(bridge: DesktopBridge) {
  const invalidate = useInvalidateMcp();
  return useMutation({
    mutationFn: (name: string) => bridge.agent.command({ type: "delete_mcp_server", name }),
    onError: showError,
    onSettled: invalidate,
  });
}

export function useReconnectMcpServer(bridge: DesktopBridge) {
  const invalidate = useInvalidateMcp();
  return useMutation({
    mutationFn: (name: string) => bridge.agent.command({ type: "reconnect_mcp_server", name }),
    onError: showError,
    onSettled: invalidate,
  });
}

export function useMcpSignIn(bridge: DesktopBridge) {
  const invalidate = useInvalidateMcp();
  return useMutation({
    mutationFn: (name: string) => bridge.agent.command({ type: "mcp_sign_in", name }),
    onError: showError,
    onSettled: invalidate,
  });
}

export function useMcpSignOut(bridge: DesktopBridge) {
  const invalidate = useInvalidateMcp();
  return useMutation({
    mutationFn: (name: string) => bridge.agent.command({ type: "mcp_sign_out", name }),
    onError: showError,
    onSettled: invalidate,
  });
}

export function useSaveMcpJson(bridge: DesktopBridge) {
  const invalidate = useInvalidateMcp();
  return useMutation({
    mutationFn: (text: string) => bridge.agent.command({ type: "save_mcp_json", text }),
    onSuccess: invalidate,
    onError: showError,
  });
}

// ---------------------------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------------------------

/** App tools an agent can be limited to, with whether Settings › Tools turned them off. */
export const agentToolOptionsQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.agentToolOptions,
    queryFn: () => bridge.agent.command({ type: "list_agent_tool_options" }),
  });

/** Picking or deleting an agent can also change `activeAgentId` in the settings. */
function useInvalidateAgents() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.agents }),
      queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
    ]);
}

export function useSaveAgent(bridge: DesktopBridge) {
  const invalidate = useInvalidateAgents();
  return useMutation({
    mutationFn: (agent: SaveAgentInput) => bridge.agent.command({ type: "save_agent", agent }),
    onSuccess: invalidate,
  });
}

export function useDeleteAgent(bridge: DesktopBridge) {
  const invalidate = useInvalidateAgents();
  return useMutation({
    mutationFn: (id: string) => bridge.agent.command({ type: "delete_agent", id }),
    onSuccess: invalidate,
    onError: showError,
  });
}

export function useImportAgent(bridge: DesktopBridge) {
  const invalidate = useInvalidateAgents();
  return useMutation({
    mutationFn: (json: string) => bridge.agent.command({ type: "import_agent", json }),
    onSuccess: invalidate,
    onError: showError,
  });
}

// ---------------------------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------------------------

/** The conversation list groups by workspace, so it is refetched with them. */
function useInvalidateWorkspaces() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces }),
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
    ]);
}

export function useSaveWorkspace(bridge: DesktopBridge) {
  const invalidate = useInvalidateWorkspaces();
  return useMutation({
    mutationFn: (workspace: SaveWorkspaceInput) =>
      bridge.agent.command({ type: "save_workspace", workspace }),
    onSuccess: invalidate,
  });
}

/** The AGENTS.md in a workspace's folder; keyed under the workspaces so saving refetches it. */
export const workspaceInstructionsQuery = (bridge: DesktopBridge, id: string) =>
  queryOptions({
    queryKey: [...queryKeys.workspaces, "instructions", id] as const,
    queryFn: () => bridge.agent.command({ type: "read_workspace_instructions", id }),
  });

export function useSaveWorkspaceInstructions(bridge: DesktopBridge) {
  const invalidate = useInvalidateWorkspaces();
  return useMutation({
    mutationFn: (input: { id: string; content: string }) =>
      bridge.agent.command({ type: "save_workspace_instructions", ...input }),
    onSuccess: invalidate,
  });
}

export function useDeleteWorkspace(bridge: DesktopBridge) {
  const invalidate = useInvalidateWorkspaces();
  return useMutation({
    mutationFn: (id: string) => bridge.agent.command({ type: "delete_workspace", id }),
    onSuccess: invalidate,
    onError: showError,
  });
}
