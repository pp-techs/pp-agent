import type {
  CookieSourceBrowser,
  DesktopBridge,
  SaveBrowserProfileInput,
} from "@workspace/shared";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { queryKeys } from "@/lib/queries";

function showError(error: Error) {
  toast.error(error.message);
}

/** Default profile first, then by name. */
export const browserProfilesQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.browserProfiles,
    queryFn: () => bridge.agent.command({ type: "list_browser_profiles" }),
  });

/** Installed browsers with profiles; looked up each time the import dialog opens. */
export const cookieSourcesQuery = (bridge: DesktopBridge) =>
  queryOptions({
    queryKey: queryKeys.cookieSources,
    queryFn: () => bridge.browser.cookieSources(),
    staleTime: 0,
  });

export const workspaceFolderQuery = (bridge: DesktopBridge, root: string, dir: string) =>
  queryOptions({
    queryKey: queryKeys.workspaceFolder(root, dir),
    queryFn: () => bridge.workspace.list(root, dir),
  });

export const filePreviewQuery = (bridge: DesktopBridge, root: string, path: string) =>
  queryOptions({
    queryKey: queryKeys.filePreview(root, path),
    queryFn: () => bridge.workspace.preview(root, path),
  });

/** Mutations of Settings › Browser; the agent also reports changes with `settings_changed`. */
export function useBrowserProfileCommands(bridge: DesktopBridge) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.browserProfiles });
  const save = useMutation({
    mutationFn: (profile: SaveBrowserProfileInput) =>
      bridge.agent.command({ type: "save_browser_profile", profile }),
    onSuccess: invalidate,
    onError: showError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => bridge.agent.command({ type: "delete_browser_profile", id }),
    onSuccess: invalidate,
    onError: showError,
  });
  const importCookies = useMutation({
    mutationFn: (input: {
      profileId: string;
      browser: CookieSourceBrowser;
      sourceProfile: string;
    }) => bridge.browser.importCookies(input.profileId, input.browser, input.sourceProfile),
    onSuccess: invalidate,
  });
  return { save, remove, importCookies };
}
