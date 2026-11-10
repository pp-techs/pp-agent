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
import { takeAddressFocus } from "@/lib/browser-tabs";
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
  // What the person is typing in the address bar; null shows the page's address.
  const [draft, setDraft] = React.useState<string | null>(null);
  const addressInput = React.useRef<HTMLInputElement>(null);
  const tabId = tab?.id ?? null;
  // A tab the person just opened with no address starts with the keyboard in the address bar.
  React.useEffect(() => {
    if (tabId && takeAddressFocus(tabId)) addressInput.current?.focus();
  }, [tabId]);
  usePageBounds(bridge, tab?.id ?? null, page, !hidden && tab !== null);

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
    <div className="flex min-h-0 flex-1 flex-col">
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
          onOpen={(id) => onOpen(id)}
        />
      </form>
      {tab ? (
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
