import * as React from "react";
import type { DesktopBridge, McpServerSettings, McpServerView } from "@workspace/shared";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Item, ItemDescription, ItemTitle } from "@workspace/ui/components/item";
import { Spinner } from "@workspace/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { FolderOpenIcon, LogInIcon, PlugIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { PromptModal } from "@/components/modals/prompt-modal";
import { ComputerOnlyNotice } from "@/components/settings/computer-only-notice";
import {
  McpServerMenu,
  StatusLabel,
  summarizeServerError,
  useMcpServerActions,
} from "@/components/settings/mcp-server-actions";
import { McpServerForm } from "@/components/settings/mcp-server-form";
import { isWebApp } from "@/lib/bridge";
import { mcpQuery, useMcpSignIn, useSaveMcpServer } from "@/lib/extension-queries";
import { GOOGLE_CLIENT } from "@/lib/google-oauth";
import {
  availablePresets,
  matchesPreset,
  presetServer,
  serverName,
  type McpPreset,
} from "@/lib/mcp-catalog";

type View = { kind: "list" } | { kind: "form"; name?: string };

/** A logo on a white tile, so dark marks (Notion) stay readable in the dark theme too. */
function Logo({ src, fallback }: { src: string | null; fallback: React.ReactNode }) {
  return src ? (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border bg-white p-2">
      <img src={src} alt="" draggable={false} className="size-full object-contain" />
    </span>
  ) : (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border bg-muted text-muted-foreground [&>svg]:size-5">
      {fallback}
    </span>
  );
}

function CardShell({
  logo,
  title,
  status,
  description,
  children,
  footer,
  dimmed,
}: {
  logo: React.ReactNode;
  title: string;
  /** Under the title: the connection status. */
  status?: React.ReactNode;
  description?: string;
  /** Between the description and the footer: the accounts of a service. */
  children?: React.ReactNode;
  footer?: React.ReactNode;
  dimmed?: boolean;
}) {
  return (
    <Item
      variant="outline"
      className={`h-full min-w-0 flex-col items-stretch gap-3 p-4 ${dimmed ? "opacity-70" : ""}`}
    >
      <div className="flex items-center gap-3">
        {logo}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <ItemTitle className="truncate">{title}</ItemTitle>
          {status}
        </div>
      </div>
      {description && <ItemDescription className="line-clamp-3">{description}</ItemDescription>}
      {children}
      {footer && <div className="mt-auto flex items-center gap-2 pt-1">{footer}</div>}
    </Item>
  );
}

/** One signed-in account (or folder, or open server) of a service, inside its card. */
function ServerRow({
  bridge,
  server,
  label,
  hint,
  onEdit,
}: {
  bridge: DesktopBridge;
  server: McpServerView;
  label?: string;
  /** What to check when the server refuses the connection. */
  hint?: string;
  onEdit: () => void;
}) {
  const { t } = useTranslation("extensions");
  const actions = useMcpServerActions(bridge, server);

  return (
    <div className={`flex flex-col gap-1 ${actions.enabled ? "" : "opacity-70"}`}>
      <div className="flex items-center gap-2 rounded-xl bg-muted/50 py-1.5 pr-1.5 pl-3">
        <div className="flex min-w-0 flex-1 flex-col">
          {label && <span className="truncate text-sm font-medium">{label}</span>}
          <StatusLabel server={server} />
        </div>
        {actions.busy && <Spinner />}
        {server.state === "needs-auth" && (
          <Button size="sm" variant="outline" disabled={actions.busy} onClick={actions.signIn}>
            <LogInIcon />
            {t("mcp.row.signIn")}
          </Button>
        )}
        <McpServerMenu server={server} actions={actions} onEdit={onEdit} withToggle />
      </div>
      {server.state === "failed" && server.error && (
        <p
          title={server.error}
          className="line-clamp-6 px-3 text-xs break-words text-destructive [overflow-wrap:anywhere]"
        >
          {hint && /status 40[13]\b/.test(server.error) ? hint : summarizeServerError(server.error)}
        </p>
      )}
    </div>
  );
}

/** What tells a service's servers apart: the account's label, or the folder. */
function rowLabel(
  preset: McpPreset,
  settings: McpServerSettings,
  several: boolean,
  mainAccount: string,
) {
  if (preset.setup === "folder") return settings.args?.at(-1);
  if (preset.setup === "oauth") return settings.account ?? (several ? mainAccount : undefined);
  return undefined;
}

export function ConnectorsSection({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation(["extensions", "common"]);
  const overview = useQuery(mcpQuery(bridge));
  const save = useSaveMcpServer(bridge);
  const signIn = useMcpSignIn(bridge);
  const [view, setView] = React.useState<View>({ kind: "list" });
  const [connecting, setConnecting] = React.useState<string | null>(null);

  const servers = overview.data?.servers ?? [];
  const back = () => setView({ kind: "list" });

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

  const groups = availablePresets(GOOGLE_CLIENT).map((preset) => ({
    preset,
    servers: servers.filter((server) => matchesPreset(preset, server.settings)),
  }));
  const grouped = new Set(groups.flatMap((group) => group.servers));
  const custom = servers.filter((server) => !grouped.has(server));
  const connected = groups.filter((group) => group.servers.length > 0);
  const available = groups.filter((group) => group.servers.length === 0);
  const ready = overview.isSuccess && !isWebApp && connecting === null;
  const edit = (server: McpServerView) => () =>
    setView({ kind: "form", name: server.settings.name });

  async function connect(preset: McpPreset, existing: McpServerView[]) {
    let folder = "";
    let account: string | undefined;
    if (preset.setup === "folder") {
      const picked = await bridge.files.pickFolder().catch((error: Error) => {
        toast.error(error.message);
        return null;
      });
      if (!picked) return;
      folder = picked;
    } else if (preset.setup === "oauth" && existing.length > 0) {
      // A second account needs a name, to tell it from the first in the cards and for the agent.
      const label = await PromptModal.show({
        title: t("connectors.addAccount.title", { name: preset.name }),
        description: t("connectors.addAccount.description"),
        label: t("connectors.addAccount.label"),
        placeholder: t("connectors.addAccount.placeholder"),
        initialValue: "",
        confirmLabel: t("connectors.connect"),
      });
      if (!label) return;
      account = label;
    }
    const about = t(`connectors.items.${preset.id}.description`);
    const name = serverName(
      preset,
      account,
      servers.map((server) => server.settings.name),
    );
    const server = presetServer(preset, {
      name,
      description: account ? `${preset.name} (${account}): ${about}` : about,
      account,
      folder,
      googleClient: GOOGLE_CLIENT,
    });
    setConnecting(preset.id);
    const added = await save.mutateAsync({ server }).then(
      () => true,
      () => false, // the mutation already showed the error
    );
    if (added) {
      toast.success(t("mcpForm.toast.added", { name: preset.name }));
      if (preset.setup === "oauth") {
        // A failed or cancelled sign-in leaves the server with its own Sign in button.
        await signIn.mutateAsync(name).then(
          () => toast.success(t("mcp.toast.signedIn", { name: preset.name })),
          () => undefined,
        );
      }
    }
    setConnecting(null);
  }

  function presetCard({ preset, servers: own }: { preset: McpPreset; servers: McpServerView[] }) {
    const folder = preset.setup === "folder";
    const first = own.length === 0;
    // An open server is one; every other kind can be added again (another account, another folder).
    const canAdd = !isWebApp && (first || preset.setup !== "open");
    const label = first
      ? t(folder ? "connectors.chooseFolder" : "connectors.connect")
      : t(folder ? "connectors.addFolder" : "connectors.addAccount.action");
    return (
      <CardShell
        key={preset.id}
        logo={<Logo src={preset.logo} fallback={<FolderOpenIcon />} />}
        title={preset.name}
        description={t(`connectors.items.${preset.id}.description`)}
        footer={
          canAdd && (
            <Button
              size="sm"
              variant={first ? "outline" : "ghost"}
              disabled={!ready}
              onClick={() => void connect(preset, own)}
            >
              {connecting === preset.id ? <Spinner /> : folder ? <FolderOpenIcon /> : <PlusIcon />}
              {label}
            </Button>
          )
        }
      >
        {own.map((server) => (
          <ServerRow
            key={server.settings.name}
            bridge={bridge}
            server={server}
            label={rowLabel(preset, server.settings, own.length > 1, t("connectors.mainAccount"))}
            hint={preset.googleScopes ? t("connectors.googleRefused") : undefined}
            onEdit={edit(server)}
          />
        ))}
      </CardShell>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {t("connectors.description")}
        </p>
        {!isWebApp && (
          <Button variant="outline" onClick={() => setView({ kind: "form" })}>
            <PlusIcon />
            {t("connectors.custom.action")}
          </Button>
        )}
      </div>

      {isWebApp && <ComputerOnlyNotice />}

      {overview.isError && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("mcp.loadError")}</AlertTitle>
          <AlertDescription>{overview.error.message}</AlertDescription>
        </Alert>
      )}

      {connected.length + custom.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">{t("connectors.sections.connected")}</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {connected.map(presetCard)}
            {custom.map((server) => (
              <CardShell
                key={server.settings.name}
                logo={<Logo src={null} fallback={<PlugIcon />} />}
                title={server.settings.name}
                description={server.settings.description}
              >
                <ServerRow bridge={bridge} server={server} onEdit={edit(server)} />
              </CardShell>
            ))}
          </div>
        </section>
      )}

      {available.length > 0 && (
        <section className="flex flex-col gap-3">
          {connected.length + custom.length > 0 && (
            <h3 className="text-sm font-medium">{t("connectors.sections.available")}</h3>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{available.map(presetCard)}</div>
        </section>
      )}
    </div>
  );
}
