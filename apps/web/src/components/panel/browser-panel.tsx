import * as React from "react";
import {
  type BrowserProfile,
  type BrowserState,
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
  ChevronDownIcon,
  GlobeIcon,
  RotateCwIcon,
  SettingsIcon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { SettingsModal } from "@/components/modals/settings-modal";
import { NewTabButton, PanelTab, PanelTabs } from "@/components/panel/panel-tabs";
import { browserProfilesQuery } from "@/lib/panel-queries";

/** Popups, menus and dialogs of the app: the page, a native view, would hide them. */
const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

function showError(error: unknown) {
  toast.error(error instanceof Error ? error.message : String(error));
}

/** Tabs and the active tab, kept in sync with the main process. */
function useBrowserState(bridge: DesktopBridge): BrowserState | null {
  const [state, setState] = React.useState<BrowserState | null>(null);
  React.useEffect(() => {
    const unsubscribe = bridge.browser.onState(setState);
    bridge.browser.state().then(setState).catch(showError);
    return unsubscribe;
  }, [bridge]);
  return state;
}

/**
 * Keeps the native page where `element` is, and hides it while the element is hidden or an app
 * popup is open (it would be drawn over the popup).
 */
function usePageBounds(bridge: DesktopBridge, element: HTMLElement | null, visible: boolean) {
  React.useEffect(() => {
    if (!element || !visible) {
      bridge.browser.setBounds(null);
      return;
    }
    let overlay = document.querySelector(OVERLAY_SELECTOR) !== null;
    let frame = 0;
    const send = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        bridge.browser.setBounds(
          overlay || rect.width === 0 || rect.height === 0
            ? null
            : { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        );
      });
    };
    const resize = new ResizeObserver(send);
    resize.observe(element);
    window.addEventListener("resize", send);
    const popups = new MutationObserver(() => {
      const next = document.querySelector(OVERLAY_SELECTOR) !== null;
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
      bridge.browser.setBounds(null);
    };
  }, [bridge, element, visible]);
}

function tabLabel(tab: BrowserTab, fallback: string): string {
  if (tab.title) return tab.title;
  if (URL.canParse(tab.url)) return new URL(tab.url).hostname;
  return fallback;
}

function TabStrip({
  bridge,
  state,
  profiles,
  onNewTab,
}: {
  bridge: DesktopBridge;
  state: BrowserState;
  profiles: Map<string, BrowserProfile>;
  onNewTab: () => void;
}) {
  const { t } = useTranslation("chat");
  return (
    <PanelTabs>
      {state.tabs.map((tab) => {
        const profile =
          tab.profileId === DEFAULT_BROWSER_PROFILE_ID ? null : profiles.get(tab.profileId);
        const label = tabLabel(tab, t("panel.browser.newTab"));
        return (
          <PanelTab
            key={tab.id}
            active={tab.id === state.activeId}
            icon={<GlobeIcon className={tab.loading ? "animate-pulse" : undefined} />}
            label={label}
            title={profile ? `${label} · ${profile.name}` : label}
            badge={
              profile && (
                <span className="shrink-0 rounded-sm bg-background px-1 text-[10px] text-muted-foreground">
                  {profile.name}
                </span>
              )
            }
            closeLabel={t("panel.browser.closeTab", { name: label })}
            onSelect={() => bridge.browser.activate(tab.id).catch(showError)}
            onClose={() => bridge.browser.close(tab.id).catch(showError)}
          />
        );
      })}
      <NewTabButton label={t("panel.browser.newTab")} onClick={onNewTab} />
    </PanelTabs>
  );
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
        <DropdownMenuItem onClick={() => void SettingsModal.show({ bridge, section: "browser" })}>
          <SettingsIcon />
          {t("panel.browser.manageProfiles")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Tabbed web browser with separate sign-in profiles. */
export function BrowserPanel({ bridge, hidden }: { bridge: DesktopBridge; hidden: boolean }) {
  const { t } = useTranslation("chat");
  const state = useBrowserState(bridge);
  const profilesQuery = useQuery(browserProfilesQuery(bridge));
  const profileList = React.useMemo(() => profilesQuery.data ?? [], [profilesQuery.data]);
  const profiles = React.useMemo(
    () => new Map(profileList.map((profile) => [profile.id, profile])),
    [profileList],
  );
  const active = state?.tabs.find((tab) => tab.id === state.activeId) ?? null;
  const [page, setPage] = React.useState<HTMLDivElement | null>(null);
  // What the person is typing in the address bar; null shows the page's address.
  const [draft, setDraft] = React.useState<string | null>(null);
  const addressInput = React.useRef<HTMLInputElement>(null);
  usePageBounds(bridge, page, !hidden && active !== null);

  const shownUrl = active?.url ?? "";
  const address = draft ?? shownUrl;

  const profileId = active?.profileId ?? DEFAULT_BROWSER_PROFILE_ID;
  const open = React.useCallback(
    (inProfile: string, url?: string) => {
      bridge.browser
        .open(inProfile, url)
        .then(() => {
          if (!url) requestAnimationFrame(() => addressInput.current?.focus());
        })
        .catch(showError);
    },
    [bridge],
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const input = address.trim();
    if (!input) return;
    setDraft(null);
    addressInput.current?.blur();
    if (active) bridge.browser.navigate(active.id, input).catch(showError);
    else open(profileId, input);
  }

  if (state === null) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {state.tabs.length > 0 && (
        <TabStrip
          bridge={bridge}
          state={state}
          profiles={profiles}
          onNewTab={() => open(profileId)}
        />
      )}
      <form className="flex shrink-0 items-center gap-0.5 px-2 pb-2" onSubmit={submit}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("panel.browser.back")}
          disabled={!active?.canGoBack}
          onClick={() => active && bridge.browser.go(active.id, "back").catch(showError)}
        >
          <ArrowLeftIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("panel.browser.forward")}
          disabled={!active?.canGoForward}
          onClick={() => active && bridge.browser.go(active.id, "forward").catch(showError)}
        >
          <ArrowRightIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={active?.loading ? t("panel.browser.stop") : t("panel.browser.reload")}
          disabled={!active}
          onClick={() =>
            active &&
            bridge.browser.go(active.id, active.loading ? "stop" : "reload").catch(showError)
          }
        >
          {active?.loading ? <XIcon /> : <RotateCwIcon />}
        </Button>
        <Input
          ref={addressInput}
          value={address}
          placeholder={t("panel.browser.addressPlaceholder")}
          aria-label={t("panel.browser.address")}
          className="mx-1 h-7 min-w-0 flex-1 text-xs"
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
        <ProfileMenu
          bridge={bridge}
          current={profiles.get(profileId)}
          profiles={profileList}
          onOpen={(id) => open(id)}
        />
      </form>
      {active ? (
        <div ref={setPage} className="min-h-0 flex-1 bg-white" />
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
