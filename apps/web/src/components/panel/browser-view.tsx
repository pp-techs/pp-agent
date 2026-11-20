import * as React from "react";
import {
  type BrowserProfile,
  type BrowserTab,
  DEFAULT_BROWSER_PROFILE_ID,
  type DesktopBridge,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { Input } from "@workspace/ui/components/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  GlobeIcon,
  RotateCwIcon,
  SearchIcon,
  TriangleAlertIcon,
  SettingsIcon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { IS_MAC } from "@/hooks/use-panel-shortcut";
import { SettingsModal } from "@/components/modals/settings-modal";
import { takeAddressFocus } from "@/lib/browser-tabs";
import {
  recordVisit,
  removeSite,
  restoreSite,
  topSites,
  useHistoryVersion,
} from "@/lib/browser-history";
import { browserProfilesQuery } from "@/lib/panel-queries";

/** Popups, menus and dialogs of the app: the page, a native view, would hide them. */
const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

function showError(error: unknown) {
  toast.error(error instanceof Error ? error.message : String(error));
}

/**
 * Keeps a tab's native page where `element` is, and hides it while the element is hidden or an app
 * popup is open (it would be drawn over the popup).
 */
function usePageBounds(
  bridge: DesktopBridge,
  tabId: string | null,
  element: HTMLElement | null,
  visible: boolean,
) {
  React.useEffect(() => {
    if (!tabId || !element || !visible) return;
    // The open popups, kept from the mutation records: searching the whole document on every
    // change would cost more the longer the chat gets, and a streamed reply changes it often.
    const overlays = new Set(document.querySelectorAll(OVERLAY_SELECTOR));
    let overlay = overlays.size > 0;
    let frame = 0;
    const send = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        bridge.browser.setBounds(
          tabId,
          overlay || rect.width === 0 || rect.height === 0
            ? null
            : { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        );
      });
    };
    const resize = new ResizeObserver(send);
    resize.observe(element);
    window.addEventListener("resize", send);
    const popups = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(OVERLAY_SELECTOR)) overlays.add(node);
          for (const inner of node.querySelectorAll(OVERLAY_SELECTOR)) overlays.add(inner);
        }
        if (record.removedNodes.length > 0) {
          for (const element of overlays) if (!element.isConnected) overlays.delete(element);
        }
      }
      const next = overlays.size > 0;
      if (next === overlay) return;
      overlay = next;
      send();
    });
    popups.observe(document.body, { childList: true, subtree: true });
    send();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      popups.disconnect();
      window.removeEventListener("resize", send);
      bridge.browser.setBounds(tabId, null);
    };
  }, [bridge, tabId, element, visible]);
}

/** The profile of the active tab, and new tabs in any profile. */
function ProfileMenu({
  bridge,
  current,
  profiles,
  onOpen,
}: {
  bridge: DesktopBridge;
  current: BrowserProfile | undefined;
  profiles: BrowserProfile[];
  onOpen: (profileId: string) => void;
}) {
  const { t } = useTranslation("chat");
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="max-w-32 shrink-0 gap-1 px-2"
                  aria-label={t("panel.browser.profile", { name: current?.name ?? "" })}
                />
              }
            />
          }
        >
          <UserRoundIcon />
          <span className="truncate @max-sm/panel:hidden">{current?.name}</span>
          <ChevronDownIcon />
        </TooltipTrigger>
        <TooltipContent>
          {/* The name is hidden in a narrow panel, so the tooltip names the profile too. */}
          <p className="font-medium">{t("panel.browser.profile", { name: current?.name ?? "" })}</p>
          <p>{t("panel.browser.profileHint")}</p>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("panel.browser.newTabIn")}</DropdownMenuLabel>
          {profiles.map((profile) => (
            <DropdownMenuItem key={profile.id} onClick={() => onOpen(profile.id)}>
              <UserRoundIcon />
              <span className="truncate">{profile.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void SettingsModal.show({ bridge, section: "computer" })}>
          <SettingsIcon />
          {t("panel.browser.manageProfiles")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The page of a tab with no address yet: the sites the person goes to most. */
function StartPage({ onOpenUrl }: { onOpenUrl: (url: string) => void }) {
  const { t } = useTranslation("chat");
  const history = useHistoryVersion();
  const sites = React.useMemo(() => topSites(8), [history]);
  if (sites.length === 0) {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <GlobeIcon />
          </EmptyMedia>
          <EmptyTitle>{t("panel.browser.newTab")}</EmptyTitle>
          <EmptyDescription>{t("panel.browser.startEmpty")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-2 px-4 pt-14">
      <h2 className="px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t("panel.browser.suggested")}
      </h2>
      <div className="grid grid-cols-2 gap-2 @xs:grid-cols-4 sm:grid-cols-4">
        {sites.map((site) => {
          const host = new URL(site.url).hostname.replace(/^www\./, "");
          return (
            <div key={site.url} className="group relative">
              <button
                type="button"
                title={site.title ? `${site.title} · ${site.url}` : site.url}
                className="flex w-full flex-col items-center gap-2 rounded-xl border p-3 text-center hover:bg-accent"
                onClick={() => onOpenUrl(site.url)}
              >
                <span className="grid size-9 place-items-center rounded-full bg-muted text-sm font-semibold uppercase">
                  {host[0]}
                </span>
                <span className="w-full truncate text-xs">{host}</span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("panel.browser.removeSuggestion")}
                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => {
                  const removed = removeSite(site.url);
                  if (!removed) return;
                  toast(t("panel.browser.removedFromHistory", { site: host }), {
                    action: { label: t("panel.browser.undo"), onClick: () => restoreSite(removed) },
                  });
                }}
              >
                <XIcon />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * One browser tab's toolbar (back, forward, reload, address, profile) and its page. With no tab
 * (`tab` null) typing an address opens one. `onOpen` opens a tab in a profile, in the view's own
 * place (the side panel or the main area).
 */
export function BrowserView({
  bridge,
  tab,
  hidden,
  onOpen,
}: {
  bridge: DesktopBridge;
  tab: BrowserTab | null;
  /** Hides the page for a moment (while a drag would pass over it). */
  hidden: boolean;
  onOpen: (profileId: string, url?: string) => void;
}) {
  const { t } = useTranslation("chat");
  const profilesQuery = useQuery(browserProfilesQuery(bridge));
  const profileList = React.useMemo(() => profilesQuery.data ?? [], [profilesQuery.data]);
  const profiles = React.useMemo(
    () => new Map(profileList.map((profile) => [profile.id, profile])),
    [profileList],
  );
  const [page, setPage] = React.useState<HTMLDivElement | null>(null);
  const [finding, setFinding] = React.useState(false);
  const [findText, setFindText] = React.useState("");
  const findInput = React.useRef<HTMLInputElement>(null);
  // What the person is typing in the address bar; null shows the page's address.
  const [draft, setDraft] = React.useState<string | null>(null);
  const addressInput = React.useRef<HTMLInputElement>(null);
  const tabId = tab?.id ?? null;
  // A tab the person just opened with no address starts with the keyboard in the address bar.
  React.useEffect(() => {
    if (tabId && takeAddressFocus(tabId)) addressInput.current?.focus();
  }, [tabId]);
  // A tab with no address and nothing loading shows the start page instead of the (blank) page.
  const blank = tab !== null && tab.url === "" && !tab.loading;
  // A failed load shows our page (with Retry) instead of the native view's own error page.
  const failed = tab?.loadError != null;
  usePageBounds(bridge, tab?.id ?? null, page, !hidden && tab !== null && !blank && !failed);

  function openFind() {
    setFinding(true);
    requestAnimationFrame(() => {
      findInput.current?.focus();
      findInput.current?.select();
    });
  }
  function closeFind() {
    setFinding(false);
    if (tabId) void bridge.browser.find(tabId, "", true).catch(showError);
  }
  // Cmd+L and Cmd+F, also while the page itself (main reports it) has the keyboard.
  React.useEffect(
    () =>
      bridge.browser.onShortcut((id, shortcut) => {
        if (id !== tabId) return;
        if (shortcut === "address") {
          addressInput.current?.focus();
          addressInput.current?.select();
        } else openFind();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bridge, tabId],
  );
  function onKeyDown(event: React.KeyboardEvent) {
    const modifier = IS_MAC ? event.metaKey : event.ctrlKey;
    if (!modifier || event.altKey || event.shiftKey || !tab) return;
    const key = event.key.toLowerCase();
    if (key !== "l" && key !== "f") return;
    event.preventDefault();
    event.stopPropagation();
    if (key === "f") openFind();
    else {
      addressInput.current?.focus();
      addressInput.current?.select();
    }
  }
  const history = useHistoryVersion();
  const suggestions = React.useMemo(() => {
    const needle = (draft ?? "").trim().toLowerCase();
    if (!needle || needle === (tab?.url ?? "").toLowerCase()) return [];
    return topSites(200)
      .filter(
        (site) =>
          site.url.toLowerCase().includes(needle) || site.title.toLowerCase().includes(needle),
      )
      .slice(0, 5);
  }, [draft, tab, history]);

  const visitedUrl = tab && !tab.loading ? tab.url : "";
  const visitedTitle = tab?.title ?? "";
  React.useEffect(() => {
    if (visitedUrl) recordVisit(visitedUrl, visitedTitle);
    // A visit counts once per address, not per title change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitedUrl]);

  const shownUrl = tab?.url ?? "";
  const address = draft ?? shownUrl;
  const profileId = tab?.profileId ?? DEFAULT_BROWSER_PROFILE_ID;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const input = address.trim();
    if (!input) return;
    setDraft(null);
    addressInput.current?.blur();
    if (tab) bridge.browser.navigate(tab.id, input).catch(showError);
    else onOpen(profileId, input);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDownCapture={onKeyDown}>
      <form className="flex shrink-0 items-center gap-0.5 px-2 pb-2" onSubmit={submit}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("panel.browser.back")}
          disabled={!tab?.canGoBack}
          onClick={() => tab && bridge.browser.go(tab.id, "back").catch(showError)}
        >
          <ArrowLeftIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("panel.browser.forward")}
          disabled={!tab?.canGoForward}
          onClick={() => tab && bridge.browser.go(tab.id, "forward").catch(showError)}
        >
          <ArrowRightIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={tab?.loading ? t("panel.browser.stop") : t("panel.browser.reload")}
          disabled={!tab}
          onClick={() =>
            tab && bridge.browser.go(tab.id, tab.loading ? "stop" : "reload").catch(showError)
          }
        >
          {tab?.loading ? <XIcon /> : <RotateCwIcon />}
        </Button>
        <div className="relative min-w-0 flex-1">
          <Input
            ref={addressInput}
            value={address}
            placeholder={t("panel.browser.addressPlaceholder")}
            aria-label={t("panel.browser.address")}
            className="mx-1 h-7 w-full min-w-0 text-xs"
            spellCheck={false}
            onFocus={(event) => {
              setDraft(shownUrl);
              event.currentTarget.select();
            }}
            onBlur={() => setDraft(null)}
            onKeyDown={(event) => {
              if (event.key === "Escape") event.currentTarget.blur();
            }}
            onChange={(event) => setDraft(event.target.value)}
          />
          {suggestions.length > 0 && (
            <ul
              role="listbox"
              className="absolute top-full right-1 left-1 z-50 mt-1 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md"
            >
              {suggestions.map((site) => (
                <li key={site.url} role="option" aria-selected="false">
                  <button
                    type="button"
                    className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent"
                    // Before the blur that would drop the draft and the list.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setDraft(null);
                      addressInput.current?.blur();
                      if (tab) bridge.browser.navigate(tab.id, site.url).catch(showError);
                      else onOpen(profileId, site.url);
                    }}
                  >
                    <span className="truncate font-medium">{site.title || site.url}</span>
                    {site.title && (
                      <span className="truncate text-muted-foreground">{site.url}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {tab && Math.abs(tab.zoom - 1) > 0.01 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 px-2 text-xs tabular-nums"
            title={t("panel.browser.resetZoom")}
            onClick={() => bridge.browser.go(tab.id, "zoom-reset").catch(showError)}
          >
            {Math.round(tab.zoom * 100)}%
          </Button>
        )}
        <ProfileMenu
          bridge={bridge}
          current={profiles.get(profileId)}
          profiles={profileList}
          onOpen={(id) => onOpen(id)}
        />
      </form>
      {finding && tab && (
        <div className="mx-2 mb-2 flex shrink-0 items-center gap-1">
          <SearchIcon className="ml-1 size-3.5 text-muted-foreground" />
          <Input
            ref={findInput}
            value={findText}
            className="h-7 min-w-0 flex-1 text-xs"
            placeholder={t("panel.browser.find")}
            aria-label={t("panel.browser.find")}
            onChange={(event) => {
              setFindText(event.target.value);
              void bridge.browser.find(tab.id, event.target.value, true).catch(showError);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeFind();
              else if (event.key === "Enter") {
                event.preventDefault();
                void bridge.browser.find(tab.id, findText, !event.shiftKey).catch(showError);
              }
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("panel.browser.findPrevious")}
            onClick={() => void bridge.browser.find(tab.id, findText, false).catch(showError)}
          >
            <ChevronUpIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("panel.browser.findNext")}
            onClick={() => void bridge.browser.find(tab.id, findText, true).catch(showError)}
          >
            <ChevronDownIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("panel.browser.findClose")}
            onClick={closeFind}
          >
            <XIcon />
          </Button>
        </div>
      )}
      {tab ? (
        <div ref={setPage} className="@container relative min-h-0 flex-1 bg-background">
          {failed && tab && (
            <Empty className="absolute inset-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <TriangleAlertIcon />
                </EmptyMedia>
                <EmptyTitle>{t("panel.browser.loadFailedTitle")}</EmptyTitle>
                <EmptyDescription>
                  {tab.loadError}
                  {tab.url ? ` · ${tab.url}` : ""}
                </EmptyDescription>
              </EmptyHeader>
              <Button
                type="button"
                variant="outline"
                onClick={() => bridge.browser.go(tab.id, "reload").catch(showError)}
              >
                <RotateCwIcon />
                {t("panel.browser.retry")}
              </Button>
            </Empty>
          )}
          {blank && (
            <StartPage
              onOpenUrl={(url) => tab && bridge.browser.navigate(tab.id, url).catch(showError)}
            />
          )}
        </div>
      ) : (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <GlobeIcon />
            </EmptyMedia>
            <EmptyTitle>{t("panel.browser.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("panel.browser.emptyDescription")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
