import * as React from "react";
import { createModal } from "@buiducnhat/better-modal";
import type { DesktopBridge } from "@workspace/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@workspace/ui/components/dialog";
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
import {
  AlarmClockIcon,
  BlocksIcon,
  BookOpenIcon,
  BotIcon,
  ChevronRightIcon,
  BrainIcon,
  FolderKanbanIcon,
  MessagesSquareIcon,
  MoonStarIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { AgentsSection } from "@/components/settings/agents-section";
import { BackgroundSection } from "@/components/settings/background-section";
import { ChannelsSection } from "@/components/settings/channels-section";
import { GeneralSection } from "@/components/settings/general-section";
import { McpSection } from "@/components/settings/mcp-section";
import { MemorySection } from "@/components/settings/memory-section";
import { ScheduledTasksSection } from "@/components/settings/scheduled-tasks-section";
import { ModelsSection } from "@/components/settings/models-section";
import { SkillsSection } from "@/components/settings/skills-section";
import { SettingsSubPageProvider } from "@/components/settings/settings-subpage";
import { ToolsSection } from "@/components/settings/tools-section";
import { WorkspacesSection } from "@/components/settings/workspaces-section";

export type SettingsSection =
  | "general"
  | "models"
  | "workspaces"
  | "agents"
  | "tools"
  | "skills"
  | "memory"
  | "scheduledTasks"
  | "background"
  | "channels"
  | "mcp";

const SECTIONS: {
  id: SettingsSection;
  icon: LucideIcon;
  Component: React.ComponentType<{ bridge: DesktopBridge }>;
}[] = [
  { id: "general", icon: SlidersHorizontalIcon, Component: GeneralSection },
  { id: "models", icon: SparklesIcon, Component: ModelsSection },
  { id: "workspaces", icon: FolderKanbanIcon, Component: WorkspacesSection },
  { id: "agents", icon: BotIcon, Component: AgentsSection },
  { id: "tools", icon: WrenchIcon, Component: ToolsSection },
  { id: "skills", icon: BookOpenIcon, Component: SkillsSection },
  { id: "memory", icon: BrainIcon, Component: MemorySection },
  { id: "scheduledTasks", icon: AlarmClockIcon, Component: ScheduledTasksSection },
  { id: "background", icon: MoonStarIcon, Component: BackgroundSection },
  { id: "channels", icon: MessagesSquareIcon, Component: ChannelsSection },
  { id: "mcp", icon: BlocksIcon, Component: McpSection },
];

type SettingsModalProps = { bridge: DesktopBridge; section?: SettingsSection };

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
}: {
  bridge: DesktopBridge;
  initialSection: SettingsSection;
}) {
  const { t } = useTranslation("settings");
  const [active, setActive] = React.useState(initialSection);
  const [subPage, setSubPage] = React.useState<string | null>(null);
  // Bumped by the breadcrumb to remount the section, which returns it to its list.
  const [resetCount, setResetCount] = React.useState(0);
  const current = SECTIONS.find((section) => section.id === active) ?? SECTIONS[0];
  const Component = current.Component;
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
                      isActive={active === id}
                      aria-current={active === id ? "page" : undefined}
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
            section={t(`modal.sections.${current.id}`)}
            subPage={subPage}
            onSectionClick={() => setResetCount((count) => count + 1)}
          />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-1 pb-6">
          <SettingsSubPageProvider value={setSubPage}>
            <Component key={`${active}-${resetCount}`} bridge={bridge} />
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
  ({ modal, bridge, section = "general" }) => (
    <Dialog open={modal.visible} onOpenChange={(open) => !open && modal.resolve(undefined)}>
      <DialogContent className="flex h-[80vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <SettingsHeader />
        {/* Remount on every open so it starts at the requested section. */}
        <SettingsPanes
          key={`${modal.visible}-${section}`}
          bridge={bridge}
          initialSection={section}
        />
      </DialogContent>
    </Dialog>
  ),
);
