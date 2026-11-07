import * as React from "react";
import { createModal } from "@buiducnhat/better-modal";
import {
  type BrowserProfile,
  COOKIE_SOURCE_NAMES,
  type CookieSite,
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
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Spinner } from "@workspace/ui/components/spinner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { InfoIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { IS_MAC } from "@/hooks/use-panel-shortcut";
import {
  cookieSourceRunningQuery,
  cookieSourcesQuery,
  useBrowserProfileCommands,
} from "@/lib/panel-queries";

type ImportCookiesModalProps = { bridge: DesktopBridge; profile: BrowserProfile };

/** Sites shown at once; typing narrows the list. */
const SHOWN_SITES = 200;

function ImportForm({ bridge, profile, onDone }: ImportCookiesModalProps & { onDone: () => void }) {
  const { t } = useTranslation(["settings", "common"]);
  const sources = useQuery(cookieSourcesQuery(bridge));
  const { importCookies } = useBrowserProfileCommands(bridge);
  const [browser, setBrowser] = React.useState<CookieSourceBrowser | null>(null);
  const [sourceProfile, setSourceProfile] = React.useState<string | null>(null);
  /** Second step: the sites of the chosen profile, and which of them to import. */
  const [sites, setSites] = React.useState<CookieSite[] | null>(null);
  const [chosen, setChosen] = React.useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = React.useState("");

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

  // Windows: a browser that is still running, also in the background, keeps its cookies locked.
  const runningQuery = useQuery({
    ...cookieSourceRunningQuery(bridge, source?.browser ?? "chrome"),
    enabled: Boolean(source) && sites === null,
  });
  const running = runningQuery.data === true;

  const loadSites = useMutation({
    mutationFn: (input: { browser: CookieSourceBrowser; sourceProfile: string; quit: boolean }) =>
      bridge.browser.cookieSites(input.browser, input.sourceProfile, input.quit),
    onSuccess: (found) => {
      setSites(found);
      setChosen(new Set());
      setFilter("");
    },
    // The browser may have started since the last check: show the note and the quit button.
    onError: () => void runningQuery.refetch(),
  });

  const needle = filter.trim().toLowerCase();
  const matching = (sites ?? []).filter((entry) => entry.site.includes(needle));
  const shown = matching.slice(0, SHOWN_SITES);

  function toggle(site: string, checked: boolean) {
    setChosen((current) => {
      const next = new Set(current);
      if (checked) next.add(site);
      else next.delete(site);
      return next;
    });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!source || !chosenProfile) return;
    if (sites === null) {
      loadSites.mutate({
        browser: source.browser,
        sourceProfile: chosenProfile.id,
        quit: running,
      });
      return;
    }
    if (chosen.size === 0) return;
    importCookies.mutate(
      {
        profileId: profile.id,
        browser: source.browser,
        sourceProfile: chosenProfile.id,
        sites: [...chosen],
      },
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

  if (sites !== null && source && chosenProfile) {
    return (
      <form className="flex flex-col gap-6" onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>{t("browserSection.import.title", { name: profile.name })}</DialogTitle>
          <DialogDescription>
            {t("browserSection.import.sitesDescription", {
              browser: COOKIE_SOURCE_NAMES[source.browser],
              profile: chosenProfile.name,
            })}
          </DialogDescription>
        </DialogHeader>

        {sites.length === 0 ? (
          <Alert>
            <InfoIcon />
            <AlertDescription>{t("browserSection.import.noSites")}</AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-3">
            <Input
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t("browserSection.import.filterSites")}
              aria-label={t("browserSection.import.filterSites")}
            />
            <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
              {shown.map((entry) => {
                const checkboxId = `cookie-site-${entry.site}`;
                return (
                  <Field key={entry.site} orientation="horizontal" className="gap-2.5">
                    <Checkbox
                      id={checkboxId}
                      checked={chosen.has(entry.site)}
                      onCheckedChange={(checked) => toggle(entry.site, checked)}
                    />
                    <FieldContent className="min-w-0">
                      <FieldLabel htmlFor={checkboxId} className="text-sm font-normal">
                        <span className="truncate">{entry.site}</span>
                        <span className="text-xs text-muted-foreground">
                          {t("browserSection.import.siteCookies", { count: entry.count })}
                        </span>
                      </FieldLabel>
                    </FieldContent>
                  </Field>
                );
              })}
              {matching.length > shown.length && (
                <FieldDescription className="text-xs">
                  {t("browserSection.import.moreSites", {
                    count: matching.length - shown.length,
                  })}
                </FieldDescription>
              )}
            </div>
            <FieldDescription className="text-xs">
              {t("browserSection.import.sitesChosen", { count: chosen.size })}
            </FieldDescription>
          </div>
        )}
        {importCookies.isError && (
          <Alert variant="destructive">
            <InfoIcon />
            <AlertDescription>{importCookies.error.message}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setSites(null)}>
            {t("common:actions.back")}
          </Button>
          <Button type="submit" disabled={chosen.size === 0 || importCookies.isPending}>
            {importCookies.isPending && <Spinner />}
            {t("browserSection.import.submit")}
          </Button>
        </DialogFooter>
      </form>
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
            {source?.browser === "firefox" ? (
              <FieldDescription>{t("browserSection.import.hintFirefox")}</FieldDescription>
            ) : IS_MAC ? (
              <FieldDescription>{t("browserSection.import.hintMac")}</FieldDescription>
            ) : null}
          </Field>
          {running && source && (
            <Alert>
              <InfoIcon />
              <AlertDescription>
                {t("browserSection.import.running", {
                  browser: COOKIE_SOURCE_NAMES[source.browser],
                })}
              </AlertDescription>
            </Alert>
          )}
          {loadSites.isError && (
            <Alert variant="destructive">
              <InfoIcon />
              <AlertDescription>{loadSites.error.message}</AlertDescription>
            </Alert>
          )}
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          type="submit"
          disabled={!chosenProfile || runningQuery.isPending || loadSites.isPending}
        >
          {loadSites.isPending && <Spinner />}
          {running && source
            ? t("browserSection.import.nextQuit", {
                browser: COOKIE_SOURCE_NAMES[source.browser],
              })
            : t("browserSection.import.next")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Copies the cookies of the sites the person picks, from a browser installed on the computer, into a profile. */
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
