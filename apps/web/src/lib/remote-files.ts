import type { DesktopBridge } from "@workspace/shared";
import { queryOptions } from "@tanstack/react-query";

import { queryKeys } from "@/lib/queries";

/**
 * The workspace's files, read over the remote connection: the app on a phone has no file system
 * of the computer to browse (see the `list_workspace_files` and `preview_workspace_file`
 * commands). Always fetched afresh: the computer is the only writer.
 */
export const remoteFolderQuery = (bridge: DesktopBridge, workspaceId: string, dir: string) =>
  queryOptions({
    queryKey: queryKeys.remoteFolder(workspaceId, dir),
    queryFn: () => bridge.agent.command({ type: "list_workspace_files", workspaceId, dir }),
    staleTime: 0,
  });

export const remoteFileQuery = (bridge: DesktopBridge, workspaceId: string, path: string) =>
  queryOptions({
    queryKey: queryKeys.remoteFile(workspaceId, path),
    queryFn: () => bridge.agent.command({ type: "preview_workspace_file", workspaceId, path }),
    staleTime: 0,
  });
