import * as React from "react";
import type { DesktopBridge, McpServerState, McpServerView } from "@workspace/shared";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Spinner } from "@workspace/ui/components/spinner";
import { Switch } from "@workspace/ui/components/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  BracesIcon,
  FolderOpenIcon,
  LogInIcon,
  LogOutIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/modals/confirm-modal";
import { McpJsonEditor } from "@/components/settings/mcp-json-editor";
import { McpServerForm } from "@/components/settings/mcp-server-form";
import { SectionHeading } from "@/components/settings/section-heading";
import {
  mcpQuery,
  useDeleteMcpServer,
  useMcpSignIn,
  useMcpSignOut,
  useReconnectMcpServer,
  useSaveMcpServer,
} from "@/lib/extension-queries";

type View = { kind: "list" } | { kind: "form"; name?: string } | { kind: "json" };

const STATE_STYLE = {
  connected: { dot: "bg-emerald-500", label: "mcp.states.connected" },
  starting: { dot: "bg-amber-500 animate-pulse", label: "mcp.states.connecting" },
  connecting: { dot: "bg-amber-500 animate-pulse", label: "mcp.states.connecting" },
  failed: { dot: "bg-destructive", label: "mcp.states.failed" },
  "needs-auth": { dot: "bg-amber-500", label: "mcp.states.needsAuth" },
  disabled: { dot: "bg-muted-foreground/40", label: "mcp.states.disabled" },
  disconnected: { dot: "bg-muted-foreground/40", label: "mcp.states.disconnected" },
} as const satisfies Record<McpServerState, { dot: string; label: string }>;

function StatusLabel({ server }: { server: McpServerView }) {
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

function ServerRow({
  bridge,
  server,
  onEdit,
}: {
  bridge: DesktopBridge;
  server: McpServerView;
  onEdit: () => void;
}) {
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
  const enabled = save.isPending ? save.variables.server.enabled : settings.enabled;

  function onToggle(value: boolean) {
    save.mutate({ originalName: settings.name, server: { ...settings, enabled: value } });
  }

  function onReconnect() {
    reconnect.mutate(settings.name, {
      onSuccess: () => toast.success(t("mcp.toast.reconnected", { name: settings.name })),
    });
  }

  function onSignIn() {
    signIn.mutate(settings.name, {
      onSuccess: () => toast.success(t("mcp.toast.signedIn", { name: settings.name })),
    });
  }

  async function onSignOut() {
    const confirmed = await ConfirmModal.show({
      title: t("mcp.signOutConfirm.title", { name: settings.name }),
      description: t("mcp.signOutConfirm.description"),
      confirmLabel: t("mcp.row.signOut"),
    });
    if (!confirmed) return;
    signOut.mutate(settings.name, {
      onSuccess: () => toast.success(t("mcp.toast.signedOut", { name: settings.name })),
    });
  }

  async function onDelete() {
    const confirmed = await ConfirmModal.show({
      title: t("mcp.removeConfirm.title"),
      description: t("mcp.removeConfirm.description", { name: settings.name }),
      confirmLabel: t("common:actions.remove"),
    });
    if (!confirmed) return;
    remove.mutate(settings.name, {
      onSuccess: () => toast.success(t("mcp.toast.removed", { name: settings.name })),
    });
  }

  const where = settings.transport === "http" ? settings.url : settings.command;

  return (
    <Item variant="outline" size="sm" className={enabled ? undefined : "opacity-70"}>
      <ItemContent className="min-w-0">
        <ItemTitle className="flex-wrap">
          <span>{settings.name}</span>
          <StatusLabel server={server} />
        </ItemTitle>
        {settings.description && (
          <ItemDescription className="line-clamp-2">{settings.description}</ItemDescription>
        )}
        {where && <ItemDescription className="truncate font-mono text-xs">{where}</ItemDescription>}
        {server.state === "failed" && server.error && (
          <ItemDescription className="line-clamp-3 text-xs text-destructive">
            {server.error}
          </ItemDescription>
        )}
      </ItemContent>
      <ItemActions>
        {busy && <Spinner />}
        {server.state === "needs-auth" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={onSignIn}>
            <LogInIcon />
            {t("mcp.row.signIn")}
          </Button>
        )}
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <Switch
              checked={enabled}
              disabled={busy}
              onCheckedChange={onToggle}
              aria-label={
                enabled
                  ? t("mcp.row.turnOffNamed", { name: settings.name })
                  : t("mcp.row.turnOnNamed", { name: settings.name })
              }
            />
          </TooltipTrigger>
          <TooltipContent>{enabled ? t("mcp.row.turnOff") : t("mcp.row.turnOn")}</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("mcp.row.actionsFor", { name: settings.name })}
              />
            }
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem disabled={!enabled || busy} onClick={onReconnect}>
              <RefreshCwIcon />
              {t("mcp.row.reconnect")}
            </DropdownMenuItem>
            {server.usesOAuth && (
              <>
                <DropdownMenuItem disabled={!enabled || busy} onClick={onSignIn}>
                  <LogInIcon />
                  {t("mcp.row.signIn")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void onSignOut()}
                >
                  <LogOutIcon />
                  {t("mcp.row.signOut")}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem onClick={onEdit}>
              <PencilIcon />
              {t("common:actions.edit")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void onDelete()}>
              <Trash2Icon />
              {t("common:actions.remove")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ItemActions>
    </Item>
  );
}

function ServersSkeleton() {
  const { t } = useTranslation(["extensions", "common"]);
  return (
    <div className="flex flex-col gap-2.5">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> {t("mcp.checking")}
      </p>
      {Array.from({ length: 2 }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full rounded-2xl" />
      ))}
    </div>
  );
}

export function McpSection({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation(["extensions", "common"]);
  const overview = useQuery(mcpQuery(bridge));
  const [view, setView] = React.useState<View>({ kind: "list" });

  const servers = overview.data?.servers ?? [];
  const back = () => setView({ kind: "list" });

  if (view.kind === "json") return <McpJsonEditor bridge={bridge} onDone={back} />;
  if (view.kind === "form") {
    const editing = servers.find((server) => server.settings.name === view.name)?.settings;
    return (
      <McpServerForm
        key={view.name ?? ""}
        bridge={bridge}
        server={editing}
        existingNames={servers.map((server) => server.settings.name)}
        onDone={back}
      />
    );
  }

  const configPath = overview.data?.configPath;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading title={t("mcp.heading.title")} description={t("mcp.heading.description")}>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("mcp.checkAgain")}
                disabled={overview.isFetching}
                onClick={() => void overview.refetch()}
              />
            }
          >
            {overview.isFetching ? <Spinner /> : <RefreshCwIcon />}
          </TooltipTrigger>
          <TooltipContent>{t("mcp.checkAgain")}</TooltipContent>
        </Tooltip>
        <Button variant="outline" onClick={() => setView({ kind: "json" })}>
          <BracesIcon />
          {t("mcp.editJson")}
        </Button>
        <Button onClick={() => setView({ kind: "form" })}>
          <PlusIcon />
          {t("mcp.addServer")}
        </Button>
      </SectionHeading>

      {overview.data && overview.data.configErrors.length > 0 && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("mcp.configErrors")}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {overview.data.configErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {overview.isPending ? (
        <ServersSkeleton />
      ) : overview.isError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("mcp.loadError")}</AlertTitle>
          <AlertDescription>{overview.error.message}</AlertDescription>
        </Alert>
      ) : servers.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PlugIcon />
            </EmptyMedia>
            <EmptyTitle>{t("mcp.empty.title")}</EmptyTitle>
            <EmptyDescription>{t("mcp.empty.description")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button variant="outline" onClick={() => setView({ kind: "json" })}>
              <BracesIcon />
              {t("mcp.empty.paste")}
            </Button>
            <Button onClick={() => setView({ kind: "form" })}>
              <PlusIcon />
              {t("mcp.addServer")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <ItemGroup>
          {servers.map((server) => (
            <ServerRow
              key={server.settings.name}
              bridge={bridge}
              server={server}
              onEdit={() => setView({ kind: "form", name: server.settings.name })}
            />
          ))}
        </ItemGroup>
      )}

      {configPath && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{t("mcp.savedIn")}</span>
          <code className="truncate font-mono">{configPath}</code>
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              bridge.files.reveal(configPath).catch((error: Error) => toast.error(error.message))
            }
          >
            <FolderOpenIcon />
            {t("showInFolder")}
          </Button>
        </div>
      )}
    </div>
  );
}
