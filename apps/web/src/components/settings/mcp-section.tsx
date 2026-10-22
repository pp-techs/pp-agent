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

const STATE_STYLE: Record<McpServerState, { dot: string; label: string }> = {
  connected: { dot: "bg-emerald-500", label: "Connected" },
  starting: { dot: "bg-amber-500 animate-pulse", label: "Connecting…" },
  connecting: { dot: "bg-amber-500 animate-pulse", label: "Connecting…" },
  failed: { dot: "bg-destructive", label: "Couldn't connect" },
  "needs-auth": { dot: "bg-amber-500", label: "Needs sign-in" },
  disabled: { dot: "bg-muted-foreground/40", label: "Turned off" },
  disconnected: { dot: "bg-muted-foreground/40", label: "Not connected" },
};

function StatusLabel({ server }: { server: McpServerView }) {
  const style = STATE_STYLE[server.state];
  const tools =
    server.state === "connected"
      ? ` · ${server.toolCount} ${server.toolCount === 1 ? "tool" : "tools"}`
      : "";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${style.dot}`} />
      {style.label}
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
      onSuccess: () => toast.success(`Reconnected to “${settings.name}”`),
    });
  }

  function onSignIn() {
    signIn.mutate(settings.name, {
      onSuccess: () => toast.success(`Signed in to “${settings.name}”`),
    });
  }

  async function onSignOut() {
    const confirmed = await ConfirmModal.show({
      title: `Sign out of “${settings.name}”?`,
      description: "The agent won't be able to use this server until you sign in again.",
      confirmLabel: "Sign out",
    });
    if (!confirmed) return;
    signOut.mutate(settings.name, {
      onSuccess: () => toast.success(`Signed out of “${settings.name}”`),
    });
  }

  async function onDelete() {
    const confirmed = await ConfirmModal.show({
      title: "Remove this server?",
      description: `“${settings.name}” and its tools will no longer be available to the agent.`,
      confirmLabel: "Remove",
    });
    if (!confirmed) return;
    remove.mutate(settings.name, {
      onSuccess: () => toast.success(`“${settings.name}” removed`),
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
            Sign in
          </Button>
        )}
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <Switch
              checked={enabled}
              disabled={busy}
              onCheckedChange={onToggle}
              aria-label={enabled ? `Turn off ${settings.name}` : `Turn on ${settings.name}`}
            />
          </TooltipTrigger>
          <TooltipContent>{enabled ? "Turn off" : "Turn on"}</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${settings.name}`} />
            }
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem disabled={!enabled || busy} onClick={onReconnect}>
              <RefreshCwIcon />
              Reconnect
            </DropdownMenuItem>
            {server.usesOAuth && (
              <>
                <DropdownMenuItem disabled={!enabled || busy} onClick={onSignIn}>
                  <LogInIcon />
                  Sign in
                </DropdownMenuItem>
                <DropdownMenuItem disabled={busy} onClick={() => void onSignOut()}>
                  <LogOutIcon />
                  Sign out
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem onClick={onEdit}>
              <PencilIcon />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void onDelete()}>
              <Trash2Icon />
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ItemActions>
    </Item>
  );
}

function ServersSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Checking connections… this can take a few seconds.
      </p>
      {Array.from({ length: 2 }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full rounded-2xl" />
      ))}
    </div>
  );
}

export function McpSection({ bridge }: { bridge: DesktopBridge }) {
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
      <SectionHeading
        title="MCP servers"
        description="Connect the agent to business systems such as a CRM, ticketing, or a database."
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Check connections again"
                disabled={overview.isFetching}
                onClick={() => void overview.refetch()}
              />
            }
          >
            {overview.isFetching ? <Spinner /> : <RefreshCwIcon />}
          </TooltipTrigger>
          <TooltipContent>Check connections again</TooltipContent>
        </Tooltip>
        <Button variant="outline" onClick={() => setView({ kind: "json" })}>
          <BracesIcon />
          Edit mcp.json
        </Button>
        <Button onClick={() => setView({ kind: "form" })}>
          <PlusIcon />
          Add server
        </Button>
      </SectionHeading>

      {overview.data && overview.data.configErrors.length > 0 && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Some servers in mcp.json couldn't be loaded</AlertTitle>
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
          <AlertTitle>Couldn't load your MCP servers</AlertTitle>
          <AlertDescription>{overview.error.message}</AlertDescription>
        </Alert>
      ) : servers.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PlugIcon />
            </EmptyMedia>
            <EmptyTitle>No servers yet</EmptyTitle>
            <EmptyDescription>
              MCP servers give the agent tools for your business systems. Add one with the details
              from its setup guide, or paste a configuration from Claude Desktop or Cursor.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button variant="outline" onClick={() => setView({ kind: "json" })}>
              <BracesIcon />
              Paste a configuration
            </Button>
            <Button onClick={() => setView({ kind: "form" })}>
              <PlusIcon />
              Add server
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
          <span>Saved in</span>
          <code className="truncate font-mono">{configPath}</code>
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              bridge.files.reveal(configPath).catch((error: Error) => toast.error(error.message))
            }
          >
            <FolderOpenIcon />
            Show in folder
          </Button>
        </div>
      )}
    </div>
  );
}
