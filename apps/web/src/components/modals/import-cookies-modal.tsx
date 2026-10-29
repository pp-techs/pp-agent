import * as React from "react";
import { createModal } from "@buiducnhat/better-modal";
import {
  type BrowserProfile,
  COOKIE_SOURCE_NAMES,
  type CookieSourceBrowser,
  type DesktopBridge,
} from "@workspace/shared";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Field, FieldDescription, FieldLabel } from "@workspace/ui/components/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Spinner } from "@workspace/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { InfoIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { IS_MAC } from "@/hooks/use-panel-shortcut";
import { cookieSourcesQuery, useBrowserProfileCommands } from "@/lib/panel-queries";

type ImportCookiesModalProps = { bridge: DesktopBridge; profile: BrowserProfile };

function ImportForm({ bridge, profile, onDone }: ImportCookiesModalProps & { onDone: () => void }) {
  const { t } = useTranslation(["settings", "common"]);
  const sources = useQuery(cookieSourcesQuery(bridge));
  const { importCookies } = useBrowserProfileCommands(bridge);
  const [browser, setBrowser] = React.useState<CookieSourceBrowser | null>(null);
  const [sourceProfile, setSourceProfile] = React.useState<string | null>(null);

  const list = sources.data ?? [];
  const source = list.find((entry) => entry.browser === browser) ?? list[0];
  const chosenProfile =
    source?.profiles.find((entry) => entry.id === sourceProfile) ?? source?.profiles[0];

  const browserItems = list.map((entry) => ({
    value: entry.browser,
    label: COOKIE_SOURCE_NAMES[entry.browser],
  }));
  const profileItems = (source?.profiles ?? []).map((entry) => ({
    value: entry.id,
    label: entry.name,
  }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!source || !chosenProfile) return;
    importCookies.mutate(
      { profileId: profile.id, browser: source.browser, sourceProfile: chosenProfile.id },
      {
        onSuccess: (result) => {
          toast.success(
            t("browserSection.import.done", {
              count: result.imported,
              browser: COOKIE_SOURCE_NAMES[source.browser],
              profile: profile.name,
            }),
            {
              description:
                result.skipped > 0
                  ? t("browserSection.import.skipped", { count: result.skipped })
                  : undefined,
            },
          );
          onDone();
        },
      },
    );
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{t("browserSection.import.title", { name: profile.name })}</DialogTitle>
        <DialogDescription>{t("browserSection.import.description")}</DialogDescription>
      </DialogHeader>

      {sources.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : list.length === 0 ? (
        <Alert>
          <InfoIcon />
          <AlertDescription>{t("browserSection.import.none")}</AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="cookie-source-browser">
              {t("browserSection.import.browser")}
            </FieldLabel>
            <Select
              items={browserItems}
              value={source?.browser ?? null}
              onValueChange={(next) => {
                if (next === null) return;
                setBrowser(next);
                setSourceProfile(null);
              }}
            >
              <SelectTrigger id="cookie-source-browser" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {browserItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="cookie-source-profile">
              {t("browserSection.import.sourceProfile")}
            </FieldLabel>
            <Select
              items={profileItems}
              value={chosenProfile?.id ?? null}
              onValueChange={(next) => next !== null && setSourceProfile(next)}
            >
              <SelectTrigger id="cookie-source-profile" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {profileItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              {source?.browser === "firefox"
                ? t("browserSection.import.hintFirefox")
                : IS_MAC
                  ? t("browserSection.import.hintMac")
                  : t("browserSection.import.hintWindows")}
            </FieldDescription>
          </Field>
          {importCookies.isError && (
            <Alert variant="destructive">
              <InfoIcon />
              <AlertDescription>{importCookies.error.message}</AlertDescription>
            </Alert>
          )}
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common:actions.cancel")}
        </Button>
        <Button type="submit" disabled={!chosenProfile || importCookies.isPending}>
          {importCookies.isPending && <Spinner />}
          {t("browserSection.import.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Copies every cookie of a browser installed on the computer into a profile. */
export const ImportCookiesModal = createModal<ImportCookiesModalProps, void>(
  "import-cookies",
  ({ modal, ...props }) => (
    <Dialog open={modal.visible} onOpenChange={(open) => !open && modal.resolve(undefined)}>
      <DialogContent className="sm:max-w-md">
        <ImportForm {...props} onDone={() => modal.resolve(undefined)} />
      </DialogContent>
    </Dialog>
  ),
);
