import * as React from "react";
import type { DesktopBridge, RemoteAccessState, RemoteAccessStatus } from "@workspace/shared";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Spinner } from "@workspace/ui/components/spinner";
import { Switch } from "@workspace/ui/components/switch";
import { cn } from "@workspace/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  CheckIcon,
  CopyIcon,
  MonitorSmartphoneIcon,
  ShieldAlertIcon,
  SmartphoneIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/modals/confirm-modal";
import { QrCode } from "@/components/qr-code";
import { SectionHeading } from "@/components/settings/section-heading";
import { formatCountdown, useNow } from "@/components/settings/channel-ui";
import { isWebApp } from "@/lib/bridge";
import { remoteAccessQuery, useRemoteAccessCommands } from "@/lib/extension-queries";
import { i18n } from "@/lib/i18n";
import { unpairDevice, useWebSession } from "@/lib/web-bridge";
import { copyText } from "@workspace/ui/lib/clipboard";

const STATE_VARIANT: Record<RemoteAccessState, React.ComponentProps<typeof Badge>["variant"]> = {
  off: "outline",
  listening: "default",
  error: "destructive",
};

/** "2 minutes ago", "yesterday": when a device last made a request. */
function ago(time: number, now: number): string {
  const format = new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" });
  const seconds = Math.round((time - now) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 30],
    ["month", 12],
  ];
  let value = seconds;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return format.format(unit === "second" ? 0 : value, unit);
    value = Math.round(value / size);
  }
  return format.format(value, "year");
}

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation("settings");
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? t("remote.address.copied") : t("remote.address.copy")}
      onClick={() =>
        copyText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          },
          (error: unknown) => toast.error(error instanceof Error ? error.message : String(error)),
        )
      }
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

function PortForm({ bridge, status }: { bridge: DesktopBridge; status: RemoteAccessStatus }) {
  const { t } = useTranslation("settings");
  const { configure } = useRemoteAccessCommands(bridge);
  const [port, setPort] = React.useState(String(status.port));
  const parsedPort = Number(port);
  const portChanged = port !== String(status.port);
  const portValid = Number.isInteger(parsedPort) && parsedPort >= 1024 && parsedPort <= 65535;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (portValid && portChanged)
          configure.mutate({ enabled: status.enabled, port: parsedPort });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="remote-port" className="text-sm font-medium">
          {t("remote.port.label")}
        </label>
        <Input
          id="remote-port"
          inputMode="numeric"
          className="w-28"
          value={port}
          aria-invalid={!portValid}
          onChange={(event) => setPort(event.target.value.replace(/\D/g, "").slice(0, 5))}
        />
      </div>
      {portChanged && (
        <Button type="submit" variant="outline" disabled={!portValid || configure.isPending}>
          {configure.isPending && <Spinner data-icon="inline-start" />}
          {t("remote.port.apply")}
        </Button>
      )}
      <p className="basis-full text-xs text-muted-foreground">{t("remote.port.description")}</p>
    </form>
  );
}

function EnableCard({ bridge, status }: { bridge: DesktopBridge; status: RemoteAccessStatus }) {
  const { t } = useTranslation("settings");
  const { configure } = useRemoteAccessCommands(bridge);
  return (
    <Item variant="outline" className="flex-col items-stretch gap-3">
      <div className="flex items-start gap-3">
        <ItemContent>
          <ItemTitle>
            <label htmlFor="remote-access">{t("remote.enable.title")}</label>
            {status.enabled && (
              <Badge variant={STATE_VARIANT[status.state]}>
                {t(`remote.state.${status.state}`)}
              </Badge>
            )}
          </ItemTitle>
          <ItemDescription className="line-clamp-none">
            {t("remote.enable.description")}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Switch
            id="remote-access"
            checked={status.enabled}
            disabled={configure.isPending}
            aria-label={t("remote.enable.switchLabel")}
            onCheckedChange={(enabled) => configure.mutate({ enabled })}
          />
        </ItemActions>
      </div>
      {/* Starts again from the saved port whenever it changes. */}
      <PortForm key={status.port} bridge={bridge} status={status} />
      {status.error && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("remote.state.error")}</AlertTitle>
          <AlertDescription>{status.error}</AlertDescription>
        </Alert>
      )}
    </Item>
  );
}

function AddressCard({ status }: { status: RemoteAccessStatus }) {
  const { t } = useTranslation("settings");
  const [selected, setSelected] = React.useState(0);
  const now = useNow(status.pairingCode !== null);
  const pairing =
    status.pairingCode !== null && status.pairingExpiresAt !== null && status.pairingExpiresAt > now
      ? status.pairingCode
      : null;
  const url = status.urls[Math.min(selected, status.urls.length - 1)];
  if (!url) {
    return (
      <Alert>
        <TriangleAlertIcon />
        <AlertDescription>{t("remote.address.none")}</AlertDescription>
      </Alert>
    );
  }
  // The fragment never reaches the server; the page reads it and pairs.
  const target = pairing ? `${url}/#pair=${pairing}` : url;
  return (
    <Item variant="outline" className="flex-col items-stretch gap-4 sm:flex-row sm:items-start">
      <QrCode
        value={target}
        label={t("remote.address.qrLabel", { url })}
        className="size-44 shrink-0 self-center sm:self-start"
      />
      <ItemContent className="gap-2">
        <ItemTitle>{t("remote.address.title")}</ItemTitle>
        <ItemDescription className="line-clamp-none">
          {t("remote.address.description")}
          {pairing && ` ${t("remote.address.withCode")}`}
        </ItemDescription>
        <ul className="flex flex-col gap-1">
          {status.urls.map((candidate, index) => (
            <li key={candidate} className="flex items-center gap-1">
              <button
                type="button"
                className={cn(
                  "min-w-0 flex-1 truncate rounded-md px-2 py-1 text-left font-mono text-sm transition-colors hover:bg-muted",
                  candidate === url && "bg-muted font-medium",
                )}
                aria-pressed={candidate === url}
                onClick={() => setSelected(index)}
              >
                {candidate}
              </button>
              <CopyButton text={candidate} />
            </li>
          ))}
        </ul>
      </ItemContent>
    </Item>
  );
}

function PairingCard({ bridge, status }: { bridge: DesktopBridge; status: RemoteAccessStatus }) {
  const { t } = useTranslation("settings");
  const { startPairing } = useRemoteAccessCommands(bridge);
  const code = status.pairingCode;
  const expiresAt = status.pairingExpiresAt;
  const now = useNow(code !== null && expiresAt !== null);
  const expired = code !== null && expiresAt !== null && expiresAt <= now;
  const open = code !== null && !expired;
  return (
    <Item variant="outline" className="flex-col items-stretch gap-3">
      <ItemContent>
        <ItemTitle>{t("remote.pairing.title")}</ItemTitle>
        <ItemDescription className="line-clamp-none">
          {t("remote.pairing.description")}
        </ItemDescription>
      </ItemContent>
      {open && (
        <div className="flex flex-wrap items-center gap-3">
          <code
            aria-label={t("remote.pairing.code")}
            className="rounded-lg bg-muted px-3 py-1.5 font-mono text-xl tracking-[0.3em]"
          >
            {code}
          </code>
          {expiresAt !== null && (
            <span className="text-xs text-muted-foreground">
              {t("remote.pairing.expiresIn", { time: formatCountdown(expiresAt - now) })}
            </span>
          )}
        </div>
      )}
      {expired && <p className="text-xs text-muted-foreground">{t("remote.pairing.expired")}</p>}
      <div>
        <Button
          variant={open ? "outline" : "default"}
          size="sm"
          disabled={startPairing.isPending}
          onClick={() => startPairing.mutate()}
        >
          {startPairing.isPending && <Spinner data-icon="inline-start" />}
          {open ? t("remote.pairing.again") : t("remote.pairing.start")}
        </Button>
      </div>
    </Item>
  );
}

function DevicesCard({ bridge, status }: { bridge: DesktopBridge; status: RemoteAccessStatus }) {
  const { t } = useTranslation("settings");
  const { forgetDevice } = useRemoteAccessCommands(bridge);
  const now = useNow(true);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{t("remote.devices.title")}</h3>
      {status.devices.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("remote.devices.empty")}</p>
      ) : (
        <ItemGroup className="gap-2">
          {status.devices.map((device) => (
            <Item key={device.id} variant="outline" size="sm">
              <ItemMedia variant="icon">
                <SmartphoneIcon />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>
                  {device.name}
                  {device.connected && (
                    <Badge variant="secondary">{t("remote.devices.connected")}</Badge>
                  )}
                </ItemTitle>
                <ItemDescription>
                  {t("remote.devices.lastSeen", { time: ago(device.lastSeenAt, now) })}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={forgetDevice.isPending}
                  onClick={async () => {
                    const confirmed = await ConfirmModal.show({
                      title: t("remote.devices.forgetTitle", { name: device.name }),
                      description: t("remote.devices.forgetDescription"),
                      confirmLabel: t("remote.devices.forget"),
                    });
                    if (confirmed) forgetDevice.mutate(device.id);
                  }}
                >
                  {t("remote.devices.forget")}
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
    </div>
  );
}

function ComputerView({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("settings");
  const query = useQuery(remoteAccessQuery(bridge));
  const status = query.data;
  return (
    <>
      {query.isPending && <Skeleton className="h-32 w-full rounded-xl" />}
      {query.isError && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("remote.loadError")}</AlertTitle>
          <AlertDescription>{query.error.message}</AlertDescription>
        </Alert>
      )}
      {status && (
        <>
          <EnableCard bridge={bridge} status={status} />
          {status.enabled && (
            <Alert>
              <ShieldAlertIcon />
              <AlertTitle>{t("remote.warning.title")}</AlertTitle>
              <AlertDescription>{t("remote.warning.description")}</AlertDescription>
            </Alert>
          )}
          {status.state === "listening" && (
            <>
              <AddressCard status={status} />
              <PairingCard bridge={bridge} status={status} />
            </>
          )}
          {(status.enabled || status.devices.length > 0) && (
            <DevicesCard bridge={bridge} status={status} />
          )}
        </>
      )}
    </>
  );
}

/** In the web app: which device this is, and a way to sign it out. */
function DeviceView() {
  const { t } = useTranslation("settings");
  const deviceName = useWebSession((state) => state.deviceName);
  const [pending, setPending] = React.useState(false);
  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <MonitorSmartphoneIcon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{t("remote.thisDevice.title")}</ItemTitle>
        <ItemDescription className="line-clamp-none">
          {t("remote.thisDevice.description", { name: deviceName ?? "" })}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={async () => {
            const confirmed = await ConfirmModal.show({
              title: t("remote.thisDevice.unpairTitle"),
              description: t("remote.thisDevice.unpairDescription"),
              confirmLabel: t("remote.thisDevice.unpair"),
            });
            if (!confirmed) return;
            setPending(true);
            unpairDevice()
              .catch((error: unknown) =>
                toast.error(error instanceof Error ? error.message : String(error)),
              )
              .finally(() => setPending(false));
          }}
        >
          {pending && <Spinner data-icon="inline-start" />}
          {t("remote.thisDevice.unpair")}
        </Button>
      </ItemActions>
    </Item>
  );
}

/** Settings › Phone access: serve the app on the local network, pair and unpair devices. */
export function RemoteAccessSection({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("settings");
  return (
    <div className="flex flex-col gap-6">
      <SectionHeading title={t("remote.title")} description={t("remote.description")} />
      {isWebApp ? <DeviceView /> : <ComputerView bridge={bridge} />}
    </div>
  );
}
