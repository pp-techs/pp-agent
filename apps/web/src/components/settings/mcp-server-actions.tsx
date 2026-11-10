import type { DesktopBridge, McpServerState, McpServerView } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  LogInIcon,
  LogOutIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PowerIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/modals/confirm-modal";
import { isWebApp } from "@/lib/bridge";
import {
  useDeleteMcpServer,
  useMcpSignIn,
  useMcpSignOut,
  useReconnectMcpServer,
  useSaveMcpServer,
} from "@/lib/extension-queries";

const STATE_STYLE = {
  connected: { dot: "bg-emerald-500", label: "mcp.states.connected" },
  starting: { dot: "bg-amber-500 animate-pulse", label: "mcp.states.connecting" },
  connecting: { dot: "bg-amber-500 animate-pulse", label: "mcp.states.connecting" },
  failed: { dot: "bg-destructive", label: "mcp.states.failed" },
  "needs-auth": { dot: "bg-amber-500", label: "mcp.states.needsAuth" },
  disabled: { dot: "bg-muted-foreground/40", label: "mcp.states.disabled" },
  disconnected: { dot: "bg-muted-foreground/40", label: "mcp.states.disconnected" },
} as const satisfies Record<McpServerState, { dot: string; label: string }>;

/**
 * One short line of a server's error. Some servers (Google's) send a whole JSON document after
 * `status 403:`; the line stops before it, and the full text stays available as a tooltip.
 */
export function summarizeServerError(error: string) {
  const line = (error.split("\n")[0] ?? "").replace(/:\s*[{[].*$/s, "").trim();
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}
export function StatusLabel({ server }: { server: McpServerView }) {
  const { t } = useTranslation(["extensions", "common"]);
  const style = STATE_STYLE[server.state];
  const tools =
    server.state === "connected" ? ` · ${t("mcp.toolCount", { count: server.toolCount })}` : "";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${style.dot}`} />
      {t(style.label)}
      {tools}
    </span>
  );
}

/** What a person can do with one configured server; shared by the server list and the connector cards. */
export interface McpServerActions {
  /** A change is in flight: every action waits. */
  busy: boolean;
  /** Whether the server is on, counting a toggle that is still saving. */
  enabled: boolean;
  toggle: (value: boolean) => void;
  reconnect: () => void;
  signIn: () => void;
  signOut: () => Promise<void>;
  remove: () => Promise<void>;
}

export function useMcpServerActions(
  bridge: DesktopBridge,
  server: McpServerView,
): McpServerActions {
  const { t } = useTranslation(["extensions", "common"]);
  const { settings } = server;
  const save = useSaveMcpServer(bridge);
  const remove = useDeleteMcpServer(bridge);
  const reconnect = useReconnectMcpServer(bridge);
  const signIn = useMcpSignIn(bridge);
  const signOut = useMcpSignOut(bridge);
  const busy =
    save.isPending ||
    remove.isPending ||
    reconnect.isPending ||
    signIn.isPending ||
    signOut.isPending;

  return {
    busy,
    enabled: save.isPending ? save.variables.server.enabled : settings.enabled,
    toggle(value: boolean) {
      save.mutate({ originalName: settings.name, server: { ...settings, enabled: value } });
    },
    reconnect() {
      reconnect.mutate(settings.name, {
        onSuccess: () => toast.success(t("mcp.toast.reconnected", { name: settings.name })),
      });
    },
    signIn() {
      signIn.mutate(settings.name, {
        onSuccess: () => toast.success(t("mcp.toast.signedIn", { name: settings.name })),
      });
    },
    async signOut() {
      const confirmed = await ConfirmModal.show({
        title: t("mcp.signOutConfirm.title", { name: settings.name }),
        description: t("mcp.signOutConfirm.description"),
        confirmLabel: t("mcp.row.signOut"),
      });
      if (!confirmed) return;
      signOut.mutate(settings.name, {
        onSuccess: () => toast.success(t("mcp.toast.signedOut", { name: settings.name })),
      });
    },
    async remove() {
      const confirmed = await ConfirmModal.show({
        title: t("mcp.removeConfirm.title"),
        description: t("mcp.removeConfirm.description", { name: settings.name }),
        confirmLabel: t("common:actions.remove"),
      });
      if (!confirmed) return;
      remove.mutate(settings.name, {
        onSuccess: () => toast.success(t("mcp.toast.removed", { name: settings.name })),
      });
    },
  };
}

/** The ⋯ menu of a server. `onEdit` adds Edit (computer only); `withToggle` adds Turn on / off. */
export function McpServerMenu({
  server,
  actions,
  onEdit,
  withToggle,
}: {
  server: McpServerView;
  actions: McpServerActions;
  onEdit?: () => void;
  withToggle?: boolean;
}) {
  const { t } = useTranslation(["extensions", "common"]);
  const { name } = server.settings;
  const { busy, enabled } = actions;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={t("mcp.row.actionsFor", { name })} />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem disabled={!enabled || busy} onClick={actions.reconnect}>
          <RefreshCwIcon />
          {t("mcp.row.reconnect")}
        </DropdownMenuItem>
        {server.usesOAuth && (
          <>
            <DropdownMenuItem disabled={!enabled || busy} onClick={actions.signIn}>
              <LogInIcon />
              {t("mcp.row.signIn")}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={busy}
              onClick={() => void actions.signOut()}
            >
              <LogOutIcon />
              {t("mcp.row.signOut")}
            </DropdownMenuItem>
          </>
        )}
        {withToggle && !isWebApp && (
          <DropdownMenuItem disabled={busy} onClick={() => actions.toggle(!enabled)}>
            <PowerIcon />
            {enabled ? t("mcp.row.turnOff") : t("mcp.row.turnOn")}
          </DropdownMenuItem>
        )}
        {onEdit && !isWebApp && (
          <DropdownMenuItem onClick={onEdit}>
            <PencilIcon />
            {t("common:actions.edit")}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => void actions.remove()}>
          <Trash2Icon />
          {t("common:actions.remove")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
