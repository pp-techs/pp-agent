import type { ComputerApp, ComputerStatus, DesktopBridge } from "@workspace/shared";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { queryKeys } from "@/lib/queries";

function showError(error: Error) {
  toast.error(error.message);
}

/** The apps the agent may always use, and the blocked ones. */
export const computerAppsQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.computerApps,
    queryFn: () => bridge.agent.command({ type: "list_computer_apps" }),
  });

/** macOS grants change in System Settings, so the status is checked again on every return. */
export const computerStatusQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.computerStatus,
    queryFn: () => bridge.computer.status(),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

/** Mutations of Settings › Computer use; the agent also reports changes with `settings_changed`. */
export function useComputerCommands(bridge: DesktopBridge) {
  const queryClient = useQueryClient();
  const setAccess = useMutation({
    mutationFn: (input: { app: ComputerApp; access: "allowed" | "blocked" | null }) =>
      bridge.agent.command({ type: "set_computer_app_access", ...input }),
    onSuccess: (apps) => queryClient.setQueryData(queryKeys.computerApps, apps),
    onError: showError,
  });
  const requestPermissions = useMutation({
    mutationFn: () => bridge.computer.requestPermissions(),
    onSuccess: (status: ComputerStatus) =>
      queryClient.setQueryData(queryKeys.computerStatus, status),
    onError: showError,
  });
  return { setAccess, requestPermissions };
}
