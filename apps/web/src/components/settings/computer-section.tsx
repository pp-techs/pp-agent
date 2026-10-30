import type { ComputerApp, ComputerStatus, DesktopBridge } from "@workspace/shared";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
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
import { useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import {
  AppWindowIcon,
  BanIcon,
  CircleCheckIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { OptionGroup, SwitchRow } from "@/components/settings/option-group";
import { SectionHeading } from "@/components/settings/section-heading";
import {
  computerAppsQuery,
  computerStatusQuery,
  useComputerCommands,
} from "@/lib/computer-queries";
import { toolsQuery, useSetToolPolicy } from "@/lib/extension-queries";

const COMPUTER_TOOL = "computer";

type T = TFunction<"settings">;

/** What the person still has to grant in System Settings; null when nothing is missing. */
function missingGrants(status: ComputerStatus, t: T): string | null {
  if (!status.accessibility && !status.screenRecording) return t("computerSection.status.both");
  if (!status.accessibility) return t("computerSection.status.accessibility");
  if (!status.screenRecording) return t("computerSection.status.screenRecording");
  return null;
}

function AccessStatus({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("settings");
  const status = useQuery(computerStatusQuery(bridge));
  const { requestPermissions } = useComputerCommands(bridge);

  if (status.isPending) return <Skeleton className="h-16 w-full rounded-2xl" />;
  if (status.isError)
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>{t("computerSection.status.loadError")}</AlertTitle>
        <AlertDescription>{status.error.message}</AlertDescription>
      </Alert>
    );
  if (!status.data.supported)
    return (
      <Alert>
        <BanIcon />
        <AlertTitle>{t("computerSection.status.unsupported")}</AlertTitle>
      </Alert>
    );
  const missing = missingGrants(status.data, t);
  if (!missing)
    return (
      <Alert>
        <ShieldCheckIcon />
        <AlertTitle>{t("computerSection.status.ready")}</AlertTitle>
      </Alert>
    );
  return (
    <Alert>
      <ShieldAlertIcon />
      <AlertTitle>{t("computerSection.status.missing", { what: missing })}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        {!status.data.accessibility && !status.data.screenRecording && (
          <span>{t("computerSection.status.oneAtATime")}</span>
        )}
        <span>{t("computerSection.status.restartHint")}</span>
        <Button
          size="sm"
          disabled={requestPermissions.isPending}
          onClick={() => requestPermissions.mutate()}
        >
          {t("computerSection.status.grant")}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function AppRow({
  bridge,
  app,
  list,
}: {
  bridge: DesktopBridge;
  app: ComputerApp;
  list: "allowed" | "blocked";
}) {
  const { t } = useTranslation("settings");
  const { setAccess } = useComputerCommands(bridge);
  const other = list === "allowed" ? "blocked" : "allowed";
  return (
    <Item variant="outline" size="sm">
      <ItemMedia variant="icon">{list === "allowed" ? <CircleCheckIcon /> : <BanIcon />}</ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>{app.name}</ItemTitle>
        {app.name !== app.id && (
          <ItemDescription className="truncate text-xs">{app.id}</ItemDescription>
        )}
      </ItemContent>
      <ItemActions>
        <Button
          variant="outline"
          size="sm"
          aria-label={t(`computerSection.actions.${other === "blocked" ? "block" : "allow"}`, {
            name: app.name,
          })}
          disabled={setAccess.isPending}
          onClick={() => setAccess.mutate({ app, access: other })}
        >
          {t(`computerSection.actions.${other === "blocked" ? "blockLabel" : "allowLabel"}`)}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("computerSection.actions.remove", { name: app.name })}
          disabled={setAccess.isPending}
          onClick={() => setAccess.mutate({ app, access: null })}
        >
          <Trash2Icon />
        </Button>
      </ItemActions>
    </Item>
  );
}

function AppList({
  bridge,
  apps,
  list,
}: {
  bridge: DesktopBridge;
  apps: ComputerApp[];
  list: "allowed" | "blocked";
}) {
  const { t } = useTranslation("settings");
  return (
    <OptionGroup
      legend={t(`computerSection.${list}.title`)}
      description={t(`computerSection.${list}.description`)}
    >
      {apps.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`computerSection.${list}.empty`)}</p>
      ) : (
        <ItemGroup>
          {apps.map((app) => (
            <AppRow key={app.id} bridge={bridge} app={app} list={list} />
          ))}
        </ItemGroup>
      )}
    </OptionGroup>
  );
}

/** Settings › Computer use: macOS access, the tool's switch, and the apps the agent may use. */
export function ComputerSection({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("settings");
  const tools = useQuery(toolsQuery(bridge));
  const apps = useQuery(computerAppsQuery(bridge));
  const setPolicy = useSetToolPolicy(bridge);
  const tool = tools.data?.find((entry) => entry.name === COMPUTER_TOOL);
  // Any policy but `off` counts as on; turning it on picks `auto` (looking runs, acting asks).
  const enabled = tool ? tool.policy !== "off" : false;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        title={t("computerSection.title")}
        description={t("computerSection.description")}
      />

      <OptionGroup legend={t("computerSection.status.title")}>
        <AccessStatus bridge={bridge} />
      </OptionGroup>

      <SwitchRow
        id="computer-enabled"
        label={t("computerSection.enable.title")}
        description={t("computerSection.enable.description")}
        checked={enabled}
        disabled={!tool || setPolicy.isPending}
        onCheckedChange={(value) =>
          setPolicy.mutate({ name: COMPUTER_TOOL, policy: value ? "auto" : "off" })
        }
      />

      <Alert>
        <AppWindowIcon />
        <AlertDescription>{t("computerSection.risk")}</AlertDescription>
      </Alert>

      {apps.isPending ? (
        <Skeleton className="h-24 w-full rounded-2xl" />
      ) : apps.isError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("computerSection.loadError")}</AlertTitle>
          <AlertDescription>{apps.error.message}</AlertDescription>
        </Alert>
      ) : (
        <>
          <AppList bridge={bridge} apps={apps.data.allowed} list="allowed" />
          <AppList bridge={bridge} apps={apps.data.blocked} list="blocked" />
        </>
      )}
    </div>
  );
}
