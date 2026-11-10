import * as React from "react";
import { createModal } from "@buiducnhat/better-modal";
import type { DesktopBridge } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Spinner } from "@workspace/ui/components/spinner";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@workspace/ui/components/sidebar";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import {
  ArrowLeftIcon,
  BookOpenIcon,
  BotIcon,
  ChevronRightIcon,
  BrainIcon,
  CogIcon,
  FolderKanbanIcon,
  MessagesSquareIcon,
  MonitorIcon,
  MoonStarIcon,
  ServerIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  XIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { SettingsSubPageProvider } from "@/components/settings/settings-subpage";
import { isWebApp } from "@/lib/bridge";

type SectionComponent = React.ComponentType<{ bridge: DesktopBridge }>;

/** A section loads the first time it is shown, so Settings stays out of the startup bundle. */
function lazySection<Module>(
  load: () => Promise<Module>,
  pick: (module: Module) => SectionComponent,
): SectionComponent {
  return React.lazy(() => load().then((module) => ({ default: pick(module) })));
}

const GeneralSection = lazySection(
  () => import("@/components/settings/general-section"),
  (module) => module.GeneralSection,
);
const ModelsSection = lazySection(
  () => import("@/components/settings/models-section"),
  (module) => module.ModelsSection,
);
const WorkspacesSection = lazySection(
  () => import("@/components/settings/workspaces-section"),
  (module) => module.WorkspacesSection,
);
const AgentsSection = lazySection(
  () => import("@/components/settings/agents-section"),
  (module) => module.AgentsSection,
);
const ToolsSection = lazySection(
  () => import("@/components/settings/tools-section"),
  (module) => module.ToolsSection,
);
const SkillsSection = lazySection(
  () => import("@/components/settings/skills-section"),
  (module) => module.SkillsSection,
);
const MemorySection = lazySection(
  () => import("@/components/settings/memory-section"),
  (module) => module.MemorySection,
);
const ChannelsSection = lazySection(
  () => import("@/components/settings/channels-section"),
  (module) => module.ChannelsSection,
);
const ThisComputerSection = lazySection(
  () => import("@/components/settings/this-computer-section"),
  (module) => module.ThisComputerSection,
);
const BackgroundSection = lazySection(
  () => import("@/components/settings/background-section"),
  (module) => module.BackgroundSection,
);
const RemoteAccessSection = lazySection(
  () => import("@/components/settings/remote-access-section"),
  (module) => module.RemoteAccessSection,
);
const AdvancedSection = lazySection(
  () => import("@/components/settings/advanced-section"),
  (module) => module.AdvancedSection,
);

/** Shown while a section's code loads. */
function SectionFallback() {
  return (
    <div className="flex justify-center p-6">
      <Spinner />
    </div>
  );
}

export type SettingsSection =
  | "general"
  | "models"
  | "agents"
  | "workspaces"
  | "tools"
  | "skills"
  | "memory"
  | "channels"
  | "remote"
  | "background"
  | "computer"
  | "advanced";

const ALL_SECTIONS: {
  id: SettingsSection;
  icon: LucideIcon;
  Component: SectionComponent;
  /** Set where the app window is needed: its browser, this computer's apps, its local files. */
  desktopOnly?: true;
}[] = [
  { id: "general", icon: SlidersHorizontalIcon, Component: GeneralSection },
  { id: "models", icon: SparklesIcon, Component: ModelsSection },
  { id: "agents", icon: BotIcon, Component: AgentsSection },
  { id: "workspaces", icon: FolderKanbanIcon, Component: WorkspacesSection },
  { id: "tools", icon: WrenchIcon, Component: ToolsSection },
  { id: "skills", icon: BookOpenIcon, Component: SkillsSection },
  { id: "memory", icon: BrainIcon, Component: MemorySection },
  { id: "channels", icon: MessagesSquareIcon, Component: ChannelsSection },
  { id: "remote", icon: ServerIcon, Component: RemoteAccessSection },
  { id: "background", icon: MoonStarIcon, Component: BackgroundSection },
  { id: "computer", icon: MonitorIcon, Component: ThisComputerSection, desktopOnly: true },
  { id: "advanced", icon: CogIcon, Component: AdvancedSection, desktopOnly: true },
];

const SECTIONS = isWebApp ? ALL_SECTIONS.filter((section) => !section.desktopOnly) : ALL_SECTIONS;

/** Where a desktop opens when Settings is shown without a section (the sidebar's gear). */
const DEFAULT_SECTION: SettingsSection = "general";

type SettingsModalProps = {
  bridge: DesktopBridge;
  section?: SettingsSection;
};

/** The nested sidebar is always expanded; it never toggles or persists state. */
const keepOpen = () => {};

/**
 * Keeps Cmd/Ctrl+B inside Settings: the app's sidebar would otherwise toggle behind the dialog and
 * the nested provider would overwrite the shared sidebar cookie.
 */
function stopSidebarShortcut(event: React.KeyboardEvent) {
  if (event.key === "b" && (event.metaKey || event.ctrlKey)) event.nativeEvent.stopPropagation();
}

function SettingsBreadcrumb({
  section,
  subPage,
  onSectionClick,
}: {
  section: string;
  subPage: string | null;
  onSectionClick: () => void;
}) {
  const { t } = useTranslation("settings");
  return (
    <nav aria-label={t("modal.breadcrumbLabel")} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
        <li className="shrink-0">{t("modal.breadcrumbRoot")}</li>
        <li aria-hidden className="shrink-0 [&>svg]:size-3.5">
          <ChevronRightIcon />
        </li>
        {subPage === null ? (
          <li aria-current="page" className="truncate font-medium text-foreground">
            {section}
          </li>
        ) : (
          <>
            <li className="shrink-0">
              <button
                type="button"
                className="rounded-md transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={onSectionClick}
              >
                {section}
              </button>
            </li>
            <li aria-hidden className="shrink-0 [&>svg]:size-3.5">
              <ChevronRightIcon />
            </li>
            <li aria-current="page" className="truncate font-medium text-foreground">
              {subPage}
            </li>
          </>
        )}
      </ol>
    </nav>
  );
}

function SettingsPanes({
  bridge,
  initialSection,
  onClose,
}: {
  bridge: DesktopBridge;
  /** null on a phone: start at the list of sections. */
  initialSection: SettingsSection | null;
  onClose: () => void;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const isMobile = useIsMobile();
  const [active, setActive] = React.useState<SettingsSection | null>(
    initialSection ?? (isMobile ? null : DEFAULT_SECTION),
  );
  const [subPage, setSubPage] = React.useState<string | null>(null);
  // Bumped by the breadcrumb to remount the section, which returns it to its list.
  const [resetCount, setResetCount] = React.useState(0);
  const current = SECTIONS.find((section) => section.id === active) ?? null;

  // A phone shows one level at a time: the list of sections, or one section with a way back.
  if (isMobile) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <header className="flex h-14 shrink-0 items-center gap-1 border-b px-2">
          {current ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("modal.back")}
              onClick={() => {
                // A sub page (an editor, a channel) goes back to its section first.
                if (subPage !== null) setResetCount((count) => count + 1);
                else setActive(null);
              }}
            >
              <ArrowLeftIcon />
            </Button>
          ) : (
            <span className="w-2" />
          )}
          <h2 className="min-w-0 flex-1 truncate font-heading text-base font-medium">
            {current ? (subPage ?? t(`modal.sections.${current.id}`)) : t("modal.breadcrumbRoot")}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("common:actions.close")}
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(env(safe-area-inset-bottom),1rem)]">
          {current ? (
            <div className="px-4 pt-4">
              <SettingsSubPageProvider value={setSubPage}>
                <React.Suspense fallback={<SectionFallback />}>
                  <current.Component key={`${current.id}-${resetCount}`} bridge={bridge} />
                </React.Suspense>
              </SettingsSubPageProvider>
            </div>
          ) : (
            <nav aria-label={t("modal.sidebarLabel")} className="p-2">
              <ul className="flex flex-col">
                {SECTIONS.map(({ id, icon: Icon }) => (
                  <li key={id}>
                    <button
                      type="button"
                      className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[0.9375rem] transition-colors outline-none active:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                      onClick={() => {
                        setSubPage(null);
                        setActive(id);
                      }}
                    >
                      <Icon className="size-5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{t(`modal.sections.${id}`)}</span>
                      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
      </div>
    );
  }

  const shown =
    current ?? SECTIONS.find((section) => section.id === DEFAULT_SECTION) ?? SECTIONS[0];
  const Component = shown.Component;
  return (
    <SidebarProvider
      open
      onOpenChange={keepOpen}
      onKeyDown={stopSidebarShortcut}
      className="min-h-0 flex-1"
      style={{ "--sidebar-width": "13rem" } as React.CSSProperties}
    >
      <Sidebar collapsible="none" aria-label={t("modal.sidebarLabel")}>
        <SidebarContent>
          <SidebarGroup className="pt-4">
            <SidebarGroupContent>
              <SidebarMenu>
                {SECTIONS.map(({ id, icon: Icon }) => (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton
                      isActive={shown.id === id}
                      aria-current={shown.id === id ? "page" : undefined}
                      onClick={() => setActive(id)}
                    >
                      <Icon />
                      <span>{t(`modal.sections.${id}`)}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
        {/* Right padding keeps the breadcrumb clear of the dialog's close button. */}
        <header className="flex h-16 shrink-0 items-center gap-2 pr-16 pl-6">
          <SettingsBreadcrumb
            section={t(`modal.sections.${shown.id}`)}
            subPage={subPage}
            onSectionClick={() => setResetCount((count) => count + 1)}
          />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-1 pb-6">
          <SettingsSubPageProvider value={setSubPage}>
            <React.Suspense fallback={<SectionFallback />}>
              <Component key={`${shown.id}-${resetCount}`} bridge={bridge} />
            </React.Suspense>
          </SettingsSubPageProvider>
        </div>
      </main>
    </SidebarProvider>
  );
}

function SettingsHeader() {
  const { t } = useTranslation("settings");
  return (
    <>
      <DialogTitle className="sr-only">{t("modal.title")}</DialogTitle>
      <DialogDescription className="sr-only">{t("modal.description")}</DialogDescription>
    </>
  );
}

/** `SettingsModal.show({ bridge, section })` opens Settings at the given section. */
export const SettingsModal = createModal<SettingsModalProps, void>(
  "settings",
  ({ modal, bridge, section }) => (
    <Dialog open={modal.visible} onOpenChange={(open) => !open && modal.resolve(undefined)}>
      <DialogContent
        // A phone gets the whole screen, with its own back and close buttons in the header.
        className="flex h-[80vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl max-md:top-0 max-md:left-0 max-md:h-dvh max-md:max-w-none! max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:pt-[env(safe-area-inset-top)] max-md:ring-0 max-md:[&>[data-slot=dialog-close]]:hidden"
      >
        <SettingsHeader />
        {/* Remount on every open so it starts at the requested section. */}
        <SettingsPanes
          key={`${modal.visible}-${section ?? ""}`}
          bridge={bridge}
          initialSection={section ?? null}
          onClose={() => modal.resolve(undefined)}
        />
      </DialogContent>
    </Dialog>
  ),
);
