import type {
  CookieSourceBrowser,
  DesktopBridge,
  SaveBrowserProfileInput,
} from "@workspace/shared";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { queryKeys } from "@/lib/queries";
import { useFileTabsStore } from "@/stores/file-tabs-store";

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

/** Whether a source browser is running (Windows); checked again while the dialog is open, so starting or quitting it meanwhile is noticed. */
export const cookieSourceRunningQuery = (bridge: DesktopBridge, browser: CookieSourceBrowser) =>
  queryOptions({
    queryKey: queryKeys.cookieSourceRunning(browser),
    queryFn: () => bridge.browser.cookieSourceRunning(browser),
    staleTime: 0,
    refetchInterval: 2000,
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

/**
 * Creating, renaming and trashing files of a workspace. Errors (a name that is taken, a file that
 * is gone) are shown as a toast; the tree and the open tabs follow what changed.
 */
export function useWorkspaceFileCommands(bridge: DesktopBridge, root: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.workspaceFiles(root) });
  const tabs = useFileTabsStore.getState;
  const create = useMutation({
    mutationFn: (input: { dir: string; name: string; kind: "file" | "folder" }) =>
      bridge.workspace.create(root, input.dir, input.name, input.kind),
    onSuccess: (path, input) => {
      void refresh();
      if (input.kind === "file") tabs().open(root, path);
    },
    onError: showError,
  });
  const rename = useMutation({
    mutationFn: (input: { path: string; name: string }) =>
      bridge.workspace.rename(root, input.path, input.name),
    onSuccess: (renamed, input) => {
      tabs().rename(root, input.path, renamed);
      void refresh();
      void queryClient.invalidateQueries({ queryKey: queryKeys.filePreviews(root) });
    },
    onError: showError,
  });
  const remove = useMutation({
    mutationFn: (path: string) => bridge.workspace.remove(root, path),
    onSuccess: (_result, path) => {
      tabs().forget(root, path);
      void refresh();
    },
    onError: showError,
  });
  return { create, rename, remove };
}

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
      quitSource?: boolean;
    }) =>
      bridge.browser.importCookies(
        input.profileId,
        input.browser,
        input.sourceProfile,
        input.quitSource,
      ),
    onSuccess: invalidate,
  });
  return { save, remove, importCookies };
}
