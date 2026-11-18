import * as React from "react";
import type { DesktopBridge } from "@workspace/shared";
import { useQuery } from "@tanstack/react-query";

import { sessionsQuery } from "@/lib/queries";
import { closeSessionTabs } from "@/lib/workbench-actions";

/**
 * A conversation that leaves the list of saved ones (deleted, or cleared with its workspace) takes
 * its terminals, browser tabs and main-area layout with it; they would otherwise stay alive with
 * nobody to show them.
 */
export function useSessionCleanup(bridge: DesktopBridge) {
  const { data } = useQuery(sessionsQuery(bridge));
  const listed = React.useRef<Set<string> | null>(null);
  React.useEffect(() => {
    if (!data) return;
    const paths = new Set(data.map((session) => session.path));
    const before = listed.current;
    listed.current = paths;
    if (!before) return;
    for (const path of before) {
      if (!paths.has(path)) void closeSessionTabs(bridge, path);
    }
  }, [bridge, data]);
}
