import {
  type BrowserProfile,
  COOKIE_SOURCE_NAMES,
  DEFAULT_BROWSER_PROFILE_ID,
  type DesktopBridge,
} from "@workspace/shared";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
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
import {
  CookieIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UserRoundIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/modals/confirm-modal";
import { ImportCookiesModal } from "@/components/modals/import-cookies-modal";
import { PromptModal } from "@/components/modals/prompt-modal";
import { SectionHeading } from "@/components/settings/section-heading";
import { browserProfilesQuery, useBrowserProfileCommands } from "@/lib/panel-queries";

function ProfileRow({ bridge, profile }: { bridge: DesktopBridge; profile: BrowserProfile }) {
  const { t, i18n } = useTranslation(["settings", "common"]);
  const { save, remove } = useBrowserProfileCommands(bridge);
  const isDefault = profile.id === DEFAULT_BROWSER_PROFILE_ID;
  const { lastImport } = profile;

  async function onRename() {
    const name = await PromptModal.show({
      title: t("browserSection.renameTitle"),
      label: t("browserSection.nameLabel"),
      initialValue: profile.name,
      confirmLabel: t("common:actions.save"),
    });
    if (name && name !== profile.name) save.mutate({ id: profile.id, name });
  }

  async function onDelete() {
    const confirmed = await ConfirmModal.show({
      title: t("browserSection.deleteConfirm.title"),
      description: t("browserSection.deleteConfirm.description", { name: profile.name }),
      confirmLabel: t("common:actions.delete"),
    });
    if (!confirmed) return;
    remove.mutate(profile.id, {
      onSuccess: () => toast.success(t("browserSection.deleted", { name: profile.name })),
    });
  }

  return (
    <Item variant="outline" size="sm">
      <ItemMedia variant="icon">
        <UserRoundIcon />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="flex-wrap">
          {profile.name}
          {isDefault && <Badge variant="secondary">{t("browserSection.defaultBadge")}</Badge>}
        </ItemTitle>
        <ItemDescription>
          {lastImport
            ? t("browserSection.lastImport", {
                count: lastImport.count,
                browser: COOKIE_SOURCE_NAMES[lastImport.browser],
                profile: lastImport.sourceProfile,
                date: new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(
                  lastImport.at,
                ),
              })
            : t("browserSection.noImport")}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void ImportCookiesModal.show({ bridge, profile })}
        >
          <CookieIcon data-icon="inline-start" />
          {t("browserSection.importButton")}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("browserSection.renameLabel", { name: profile.name })}
          onClick={() => void onRename()}
        >
          <PencilIcon />
        </Button>
        {!isDefault && (
          <Button
            variant="destructive"
            size="icon-sm"
            aria-label={t("browserSection.deleteLabel", { name: profile.name })}
            disabled={remove.isPending}
            onClick={() => void onDelete()}
          >
            <Trash2Icon />
          </Button>
        )}
      </ItemActions>
    </Item>
  );
}

/** Settings › Browser: the side panel browser's sign-in profiles. */
export function BrowserSection({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation(["settings", "common"]);
  const profiles = useQuery(browserProfilesQuery(bridge));
  const { save } = useBrowserProfileCommands(bridge);

  async function onCreate() {
    const name = await PromptModal.show({
      title: t("browserSection.newTitle"),
      label: t("browserSection.nameLabel"),
      initialValue: "",
      confirmLabel: t("common:actions.create"),
    });
    if (name) save.mutate({ name });
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        title={t("browserSection.title")}
        description={t("browserSection.description")}
      >
        <Button onClick={() => void onCreate()}>
          <PlusIcon />
          {t("browserSection.newProfile")}
        </Button>
      </SectionHeading>

      {profiles.isPending ? (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 2 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : profiles.isError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("browserSection.loadError")}</AlertTitle>
          <AlertDescription>{profiles.error.message}</AlertDescription>
        </Alert>
      ) : (
        <ItemGroup>
          {profiles.data.map((profile) => (
            <ProfileRow key={profile.id} bridge={bridge} profile={profile} />
          ))}
        </ItemGroup>
      )}
      <p className="text-xs text-muted-foreground">{t("browserSection.privacy")}</p>
    </div>
  );
}
