import * as React from "react";
import type {
  DesktopBridge,
  EmailAccountView,
  McpServerSettings,
  McpServerView,
} from "@workspace/shared";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Item, ItemDescription, ItemTitle } from "@workspace/ui/components/item";
import { Spinner } from "@workspace/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import {
  FolderOpenIcon,
  LogInIcon,
  MailIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/modals/confirm-modal";
import { PromptModal } from "@/components/modals/prompt-modal";
import { ComputerOnlyNotice } from "@/components/settings/computer-only-notice";
import { EmailAccountForm } from "@/components/settings/email-account-form";
import {
  McpServerMenu,
  StatusLabel,
  summarizeServerError,
  useMcpServerActions,
} from "@/components/settings/mcp-server-actions";
import { McpServerForm } from "@/components/settings/mcp-server-form";
import { isWebApp } from "@/lib/bridge";
import {
  emailQuery,
  mcpQuery,
  useDeleteEmailAccount,
  useMcpSignIn,
  useSaveMcpServer,
  useTestEmailAccount,
} from "@/lib/extension-queries";
import { GOOGLE_CLIENT } from "@/lib/google-oauth";
import {
  addressPresetUrl,
  availablePresets,
  connectorHost,
  matchesPreset,
  presetServer,
  serverName,
  type McpPreset,
} from "@/lib/mcp-catalog";

type View = { kind: "list" } | { kind: "form"; name?: string } | { kind: "email"; name?: string };

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

/**
 * One card: the service on the left (logo, name, what connecting does), the one thing to do with
 * it on the right as a square button, and the accounts already added underneath.
 */
function CardShell({
  logo,
  title,
  description,
  action,
  children,
  dimmed,
}: {
  logo: React.ReactNode;
  title: string;
  description?: string;
  /** Connect, add another account, another hub, another folder: one button, its label read out only. */
  action?: React.ReactNode;
  /** Under the header: the accounts of a service. */
  children?: React.ReactNode;
  dimmed?: boolean;
}) {
  return (
    <Item
      variant="outline"
      className={`min-w-0 flex-col items-stretch gap-3 p-4 ${dimmed ? "opacity-70" : ""}`}
    >
      <div className="flex items-center gap-3">
        {logo}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <ItemTitle className="truncate">{title}</ItemTitle>
          {description && <ItemDescription className="line-clamp-2">{description}</ItemDescription>}
        </div>
        {action}
      </div>
      {children}
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

/** A mailbox the person added: its sign-in state, and what they can do with it. */
function EmailRow({
  bridge,
  account,
  onEdit,
}: {
  bridge: DesktopBridge;
  account: EmailAccountView;
  onEdit: () => void;
}) {
  const { t } = useTranslation(["extensions", "common"]);
  const remove = useDeleteEmailAccount(bridge);
  const test = useTestEmailAccount(bridge);
  const name = account.settings.label ?? account.settings.address;
  const busy = remove.isPending || test.isPending;
  const state = !account.hasPassword ? "noPassword" : account.error ? "failed" : "ready";

  async function onDelete() {
    const confirmed = await ConfirmModal.show({
      title: t("email.removeConfirm.title"),
      description: t("email.removeConfirm.description", { name }),
      confirmLabel: t("common:actions.remove"),
    });
    if (!confirmed) return;
    remove.mutate(account.settings.name);
  }

  return (
    <div className={`flex flex-col gap-1 ${account.hasPassword ? "" : "opacity-70"}`}>
      <div className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/50 py-1.5 pr-1.5 pl-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{name}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              aria-hidden
              className={`size-2 shrink-0 rounded-full ${
                state === "ready"
                  ? "bg-emerald-500"
                  : state === "failed"
                    ? "bg-destructive"
                    : "bg-amber-500"
              }`}
            />
            {t(`email.state.${state}`)}
            {account.settings.label ? ` · ${account.settings.address}` : ""}
          </span>
        </div>
        {busy && <Spinner />}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label={t("email.actions", { name })} />
            }
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem disabled={busy} onClick={() => test.mutate(account.settings.name)}>
              <RefreshCwIcon />
              {t("email.test")}
            </DropdownMenuItem>
            {!isWebApp && (
              <DropdownMenuItem onClick={onEdit}>
                <PencilIcon />
                {t("common:actions.edit")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void onDelete()}>
              <Trash2Icon />
              {t("common:actions.remove")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {account.error && (
        <p
          title={account.error}
          className="line-clamp-6 px-3 text-xs break-words text-destructive [overflow-wrap:anywhere]"
        >
          {summarizeServerError(account.error)}
        </p>
      )}
    </div>
  );
}

/** How many accounts a card lists before offering the rest. */
const ROWS_SHOWN = 3;

/** "Show 4 more" / "Show less" under a card that holds more accounts than it lists. */
function MoreRows({
  hidden,
  open,
  onToggle,
}: {
  hidden: number;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation("extensions");
  return (
    <button
      type="button"
      onClick={onToggle}
      className="self-start rounded-lg px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
    >
      {open ? t("connectors.rows.less") : t("connectors.rows.more", { count: hidden })}
    </button>
  );
}

/** What tells a service's servers apart: the account's label, the hub's address, or the folder. */
function rowLabel(
  preset: McpPreset,
  settings: McpServerSettings,
  several: boolean,
  mainAccount: string,
) {
  if (preset.setup === "address") return connectorHost(settings.url);
  if (preset.setup === "folder") return settings.args?.at(-1);
  if (preset.setup === "oauth" || preset.setup === "token")
    return settings.account ?? (several ? mainAccount : undefined);
  return undefined;
}

export function ConnectorsSection({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation(["extensions", "common"]);
  const overview = useQuery(mcpQuery(bridge));
  const email = useQuery(emailQuery(bridge));
  const save = useSaveMcpServer(bridge);
  const signIn = useMcpSignIn(bridge);
  const [view, setView] = React.useState<View>({ kind: "list" });
  const [connecting, setConnecting] = React.useState<string | null>(null);
  // Cards whose account list is fully open: the mailboxes, and one key per preset.
  const [expanded, setExpanded] = React.useState<readonly string[]>([]);
  const showsAll = (key: string) => expanded.includes(key);
  const toggleAll = (key: string) =>
    setExpanded((keys) =>
      keys.includes(key) ? keys.filter((open) => open !== key) : [...keys, key],
    );

  const servers = overview.data?.servers ?? [];
  const back = () => setView({ kind: "list" });

  if (view.kind === "email") {
    const editing = email.data?.find((account) => account.settings.name === view.name)?.settings;
    return (
      <EmailAccountForm
        key={view.name ?? ""}
        bridge={bridge}
        account={editing}
        existingNames={(email.data ?? []).map((account) => account.settings.name)}
        onDone={back}
      />
    );
  }

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

  const mailboxes = email.data ?? [];
  const emailCard = (
    <CardShell
      key="email"
      logo={<Logo src={null} fallback={<MailIcon />} />}
      title={t("email.cardTitle")}
      description={t("email.cardDescription")}
      action={
        !isWebApp && (
          <Button
            size="icon"
            variant="outline"
            aria-label={t("email.add")}
            title={t("email.add")}
            onClick={() => setView({ kind: "email" })}
          >
            <PlusIcon />
          </Button>
        )
      }
    >
      {(showsAll("email") ? mailboxes : mailboxes.slice(0, ROWS_SHOWN)).map((account) => (
        <EmailRow
          key={account.settings.name}
          bridge={bridge}
          account={account}
          onEdit={() => setView({ kind: "email", name: account.settings.name })}
        />
      ))}
      {mailboxes.length > ROWS_SHOWN && (
        <MoreRows
          hidden={mailboxes.length - ROWS_SHOWN}
          open={showsAll("email")}
          onToggle={() => toggleAll("email")}
        />
      )}
    </CardShell>
  );
  const edit = (server: McpServerView) => () =>
    setView({ kind: "form", name: server.settings.name });

  async function connect(preset: McpPreset, existing: McpServerView[]) {
    let folder = "";
    let address = "";
    let account: string | undefined;
    let token: string | undefined;
    if (preset.setup === "folder") {
      const picked = await bridge.files.pickFolder().catch((error: Error) => {
        toast.error(error.message);
        return null;
      });
      if (!picked) return;
      folder = picked;
    } else if (preset.setup === "address") {
      const typed = await PromptModal.show({
        title: t("connectors.address.title", { name: preset.name }),
        description: t("connectors.address.description"),
        label: t("connectors.address.label"),
        placeholder: t("connectors.address.placeholder"),
        initialValue: "",
        confirmLabel: t("connectors.connect"),
      });
      if (!typed) return;
      if (!addressPresetUrl(preset, typed)) {
        toast.error(t("connectors.address.invalid", { example: "hub.acme.vn" }));
        return;
      }
      address = typed;
    } else if ((preset.setup === "oauth" || preset.setup === "token") && existing.length > 0) {
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
    if (preset.setup === "token") {
      const typed = await PromptModal.show({
        title: t("connectors.token.title", { name: preset.name }),
        description: t("connectors.token.description", { name: preset.name, url: preset.tokenUrl }),
        label: t("connectors.token.label"),
        placeholder: t("connectors.token.placeholder"),
        initialValue: "",
        confirmLabel: t("connectors.connect"),
        secret: true,
      });
      if (!typed) return;
      token = typed;
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
      address,
      token,
      googleClient: GOOGLE_CLIENT,
    });
    setConnecting(preset.id);
    const added = await save.mutateAsync({ server }).then(
      () => true,
      () => false, // the mutation already showed the error
    );
    if (added) {
      toast.success(t("mcpForm.toast.added", { name: preset.name }));
      if (preset.setup === "oauth" || preset.setup === "address") {
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
    const hub = preset.setup === "address";
    const first = own.length === 0;
    // An open server is one; every other kind can be added again (another account, another hub).
    const canAdd = !isWebApp && (first || preset.setup !== "open");
    const label = first
      ? t(folder ? "connectors.chooseFolder" : "connectors.connect")
      : t(
          folder
            ? "connectors.addFolder"
            : hub
              ? "connectors.addHub"
              : "connectors.addAccount.action",
        );
    return (
      <CardShell
        key={preset.id}
        logo={<Logo src={preset.logo} fallback={<FolderOpenIcon />} />}
        title={preset.name}
        description={t(`connectors.items.${preset.id}.description`)}
        action={
          canAdd && (
            <Button
              size="icon"
              variant="outline"
              aria-label={label}
              title={label}
              disabled={!ready}
              onClick={() => void connect(preset, own)}
            >
              {connecting === preset.id ? <Spinner /> : folder ? <FolderOpenIcon /> : <PlusIcon />}
            </Button>
          )
        }
      >
        {(showsAll(preset.id) ? own : own.slice(0, ROWS_SHOWN)).map((server) => (
          <ServerRow
            key={server.settings.name}
            bridge={bridge}
            server={server}
            label={rowLabel(preset, server.settings, own.length > 1, t("connectors.mainAccount"))}
            hint={
              preset.googleScopes
                ? t("connectors.googleRefused")
                : preset.setup === "token"
                  ? t("connectors.tokenRefused")
                  : undefined
            }
            onEdit={edit(server)}
          />
        ))}
        {own.length > ROWS_SHOWN && (
          <MoreRows
            hidden={own.length - ROWS_SHOWN}
            open={showsAll(preset.id)}
            onToggle={() => toggleAll(preset.id)}
          />
        )}
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

      {connected.length + custom.length + (mailboxes.length > 0 ? 1 : 0) > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">{t("connectors.sections.connected")}</h3>
          <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
            {mailboxes.length > 0 && emailCard}
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
          {(connected.length > 0 || custom.length > 0 || mailboxes.length > 0) && (
            <h3 className="text-sm font-medium">{t("connectors.sections.available")}</h3>
          )}
          <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
            {mailboxes.length === 0 && emailCard}
            {available.map(presetCard)}
          </div>
        </section>
      )}
    </div>
  );
}
