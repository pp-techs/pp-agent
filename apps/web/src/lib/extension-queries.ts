import type {
  DesktopBridge,
  McpServerSettings,
  SaveAgentInput,
  SaveSkillInput,
  SaveWorkspaceInput,
  ToolPolicy,
  ToolSummary,
} from "@workspace/shared";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { queryKeys } from "@/lib/queries";

function showError(error: Error) {
  toast.error(error.message);
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

export function useDeleteWorkspace(bridge: DesktopBridge) {
  const invalidate = useInvalidateWorkspaces();
  return useMutation({
    mutationFn: (id: string) => bridge.agent.command({ type: "delete_workspace", id }),
    onSuccess: invalidate,
    onError: showError,
  });
}
