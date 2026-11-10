import * as React from "react";
import type { DesktopBridge, McpServerView } from "@workspace/shared";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
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
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";

import { McpJsonEditor } from "@/components/settings/mcp-json-editor";
import {
  McpServerMenu,
  StatusLabel,
  summarizeServerError,
  useMcpServerActions,
} from "@/components/settings/mcp-server-actions";
import { McpServerForm } from "@/components/settings/mcp-server-form";
import { useSettingsSubPage } from "@/components/settings/settings-subpage";
import { ComputerOnlyNotice } from "@/components/settings/computer-only-notice";
import { isWebApp } from "@/lib/bridge";
import { mcpQuery } from "@/lib/extension-queries";

type View = { kind: "list" } | { kind: "form"; name?: string } | { kind: "json" };

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
  const actions = useMcpServerActions(bridge, server);
  const { busy, enabled } = actions;
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
          <ItemDescription
            title={server.error}
            className="line-clamp-3 text-xs break-words text-destructive [overflow-wrap:anywhere]"
          >
            {summarizeServerError(server.error)}
          </ItemDescription>
        )}
      </ItemContent>
      <ItemActions>
        {busy && <Spinner />}
        {server.state === "needs-auth" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={actions.signIn}>
            <LogInIcon />
            {t("mcp.row.signIn")}
          </Button>
        )}
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <Switch
              checked={enabled}
              disabled={busy || isWebApp}
              onCheckedChange={actions.toggle}
              aria-label={
                enabled
                  ? t("mcp.row.turnOffNamed", { name: settings.name })
                  : t("mcp.row.turnOnNamed", { name: settings.name })
              }
            />
          </TooltipTrigger>
          <TooltipContent>{enabled ? t("mcp.row.turnOff") : t("mcp.row.turnOn")}</TooltipContent>
        </Tooltip>
        <McpServerMenu server={server} actions={actions} onEdit={onEdit} />
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
  useSettingsSubPage(t("mcp.heading.title"));
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
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {t("mcp.heading.description")}
        </p>
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
        {!isWebApp && (
          <>
            <Button variant="outline" onClick={() => setView({ kind: "json" })}>
              <BracesIcon />
              {t("mcp.editJson")}
            </Button>
            <Button onClick={() => setView({ kind: "form" })}>
              <PlusIcon />
              {t("mcp.addServer")}
            </Button>
          </>
        )}
      </div>

      {isWebApp && <ComputerOnlyNotice />}

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
          <EmptyContent className={`flex-row justify-center ${isWebApp ? "hidden" : ""}`}>
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

      {configPath && !isWebApp && (
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
