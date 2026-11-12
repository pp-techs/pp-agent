import * as React from "react";
import {
  type BrowserState,
  DEFAULT_BROWSER_PROFILE_ID,
  type DesktopBridge,
  type TerminalInfo,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Spinner } from "@workspace/ui/components/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import {
  Columns2Icon,
  FolderTreeIcon,
  GlobeIcon,
  MessageSquareIcon,
  PlusIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { FileTypeIcon } from "@/components/panel/file-icon";
import { PanelTab, PanelTabs } from "@/components/panel/panel-tabs";
import { OpenFolderButton, SidePanelButton } from "@/components/workbench/workspace-buttons";
import { isWebApp } from "@/lib/bridge";
import { useBrowserState, useTerminals, useWorkspaceWatch } from "@/hooks/use-panel-state";
import { tabLabel } from "@/lib/browser-tabs";
import { closeMainTab, closingTabs, newBrowserTab, newTerminal } from "@/lib/workbench-actions";
import { useChatStore } from "@/stores/chat-store";
import { usePanelStore } from "@/stores/panel-store";
import {
  type CenterTab,
  hostedIds,
  NO_WORKSPACE,
  SOLO,
  SPLIT,
  tabKey,
  useWorkbenchStore,
  type Workbench as WorkbenchLayout,
} from "@/stores/workbench-store";

const TabContent = React.lazy(() => import("@/components/workbench/tab-content"));

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

/** Keeps the workspace watched while the main area has file tabs, so their previews refresh. */
function FileWatch({ bridge, root }: { bridge: DesktopBridge; root: string }) {
  useWorkspaceWatch(bridge, root);
  return null;
}

/**
 * The "+" of a tab row: a new browser tab, or (in a workspace) a new terminal or the file tree in
 * the side panel.
 */
function NewTabMenu({ bridge, folder }: { bridge: DesktopBridge; folder: string | null }) {
  const { t } = useTranslation("chat");
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label={t("workbench.new")} />}
            />
          }
        >
          <PlusIcon />
        </TooltipTrigger>
        <TooltipContent>{t("workbench.new")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-56">
        {folder && !isWebApp && (
          <DropdownMenuItem onClick={() => void newTerminal(bridge, folder)}>
            <SquareTerminalIcon />
            {t("panel.terminal.new")}
          </DropdownMenuItem>
        )}
        {!isWebApp && (
          <DropdownMenuItem
            onClick={() => void newBrowserTab(bridge, folder, DEFAULT_BROWSER_PROFILE_ID)}
          >
            <GlobeIcon />
            {t("panel.browser.newTab")}
          </DropdownMenuItem>
        )}
        {folder && (
          <DropdownMenuItem onClick={() => usePanelStore.getState().setOpen(true)}>
            <FolderTreeIcon />
            {t("workbench.openFiles")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function GroupStrip({
  bridge,
  scope,
  folder,
  bench,
  index,
  terminals,
  browser,
}: {
  bridge: DesktopBridge;
  scope: string;
  folder: string | null;
  bench: WorkbenchLayout;
  index: number;
  terminals: TerminalInfo[] | null;
  browser: BrowserState | null;
}) {
  const { t } = useTranslation("chat");
  const group = bench.groups[index];
  const activate = useWorkbenchStore((state) => state.activate);
  const moveToOther = useWorkbenchStore((state) => state.moveToOther);

  function describe(tab: CenterTab): { icon: React.ReactNode; label: string; title?: string } {
    switch (tab.kind) {
      case "chat":
        return { icon: <MessageSquareIcon />, label: t("workbench.chat") };
      case "file":
        return {
          icon: <FileTypeIcon kind="file" name={baseName(tab.path)} />,
          label: baseName(tab.path),
          title: tab.path,
        };
      case "terminal": {
        const terminal = terminals?.find((item) => item.id === tab.id);
        return {
          icon: <SquareTerminalIcon />,
          label: terminal
            ? terminal.exited
              ? `${terminal.title} ${t("panel.terminal.ended")}`
              : terminal.title
            : "…",
        };
      }
      case "browser": {
        const page = browser?.tabs.find((item) => item.id === tab.id);
        return {
          icon: <GlobeIcon className={page?.loading ? "animate-pulse" : undefined} />,
          label: page ? tabLabel(page, t("panel.browser.newTab")) : "…",
        };
      }
    }
  }

  const pinnedTab = group.tabs.find((tab) => tab.kind === "chat");
  const movable = group.active !== "chat";
  const splitLabel =
    bench.groups.length === 1
      ? t("workbench.splitRight")
      : index === 0
        ? t("workbench.moveRight")
        : t("workbench.moveLeft");

  return (
    <div className="flex h-11 shrink-0 items-center border-b border-border/50 pr-2">
      {/* The chat tab is pinned: it stays at the start while the other tabs scroll. */}
      {pinnedTab && (
        <div className="flex shrink-0 items-center pl-1.5">
          <PanelTab
            active={group.active === "chat"}
            icon={describe(pinnedTab).icon}
            label={describe(pinnedTab).label}
            emphasized
            onSelect={() => activate(scope, index, "chat")}
          />
          <div className="mx-1.5 h-4 w-px shrink-0 bg-border" />
        </div>
      )}
      <PanelTabs className="min-w-0 flex-1">
        {group.tabs
          .filter((tab) => tab.kind !== "chat")
          .map((tab) => {
            const key = tabKey(tab);
            const { icon, label, title } = describe(tab);
            return (
              <PanelTab
                key={key}
                active={group.active === key}
                icon={icon}
                label={label}
                title={title}
                closeLabel={t("workbench.closeTab", { name: label })}
                onSelect={() => activate(scope, index, key)}
                onClose={() => closeMainTab(bridge, scope, tab)}
              />
            );
          })}
      </PanelTabs>
      <NewTabMenu bridge={bridge} folder={folder} />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={splitLabel}
              disabled={!movable}
              onClick={() => moveToOther(scope, group.active)}
            />
          }
        >
          <Columns2Icon />
        </TooltipTrigger>
        <TooltipContent>{splitLabel}</TooltipContent>
      </Tooltip>
      {/* The workspace folder and the file tree's toggle sit at the end of the last group's row. */}
      {index === bench.groups.length - 1 && (
        <>
          {!isWebApp && <OpenFolderButton bridge={bridge} />}
          <SidePanelButton />
        </>
      )}
    </div>
  );
}

function GroupView({
  bridge,
  scope,
  folder,
  bench,
  index,
  chat,
  terminals,
  browser,
  resizing,
}: {
  bridge: DesktopBridge;
  scope: string;
  folder: string | null;
  bench: WorkbenchLayout;
  index: number;
  chat: React.ReactNode;
  terminals: TerminalInfo[] | null;
  browser: BrowserState | null;
  resizing: boolean;
}) {
  const focus = useWorkbenchStore((state) => state.focus);
  const group = bench.groups[index];
  const tab = group.tabs.find((item) => tabKey(item) === group.active);
  const split = bench.groups.length > 1 && index === 0;

  return (
    <div
      style={{ flex: split ? `0 0 ${bench.split * 100}%` : "1 1 0%" }}
      className="@container/panel flex min-h-0 min-w-0 flex-col"
      onPointerDownCapture={() => focus(scope, index)}
    >
      <GroupStrip
        bridge={bridge}
        scope={scope}
        folder={folder}
        bench={bench}
        index={index}
        terminals={terminals}
        browser={browser}
      />
      {/* The chat stays mounted behind the other tabs, so a draft and a running reply survive. */}
      {index === 0 && (
        <div className={group.active === "chat" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          {chat}
        </div>
      )}
      {tab && tab.kind !== "chat" && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <React.Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center">
                <Spinner />
              </div>
            }
          >
            <TabContent
              key={tabKey(tab)}
              bridge={bridge}
              root={scope}
              tab={tab}
              terminals={terminals}
              browser={browser}
              hidden={resizing}
            />
          </React.Suspense>
        </div>
      )}
    </div>
  );
}

/** The drag handle between two groups. */
function Divider({
  container,
  scope,
  split,
  onResizing,
}: {
  container: React.RefObject<HTMLDivElement | null>;
  scope: string;
  split: number;
  onResizing: (resizing: boolean) => void;
}) {
  const { t } = useTranslation("chat");
  const setSplit = useWorkbenchStore((state) => state.setSplit);
  const dragging = React.useRef(false);

  function follow(clientX: number) {
    const rect = container.current?.getBoundingClientRect();
    if (rect && rect.width > 0) setSplit(scope, (clientX - rect.left) / rect.width);
  }
  const end = () => {
    if (!dragging.current) return;
    dragging.current = false;
    onResizing(false);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("workbench.resize")}
      aria-valuenow={Math.round(split * 100)}
      aria-valuemin={SPLIT.min * 100}
      aria-valuemax={SPLIT.max * 100}
      tabIndex={0}
      className="relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize outline-none after:absolute after:inset-y-3 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border focus-visible:after:bg-ring"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragging.current = true;
        onResizing(true);
      }}
      onPointerMove={(event) => {
        if (dragging.current) follow(event.clientX);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") setSplit(scope, split - 0.02);
        else if (event.key === "ArrowRight") setSplit(scope, split + 0.02);
      }}
    />
  );
}

/**
 * The main area of the window: the chat, and beside it (as tabs, in one or two groups) the files,
 * terminals and browser tabs that open there. Each workspace keeps its own layout. With nothing
 * open, the tab row holds the pinned chat tab and the "+".
 */
export function Workbench({ bridge, chat }: { bridge: DesktopBridge; chat: React.ReactNode }) {
  const folder = useChatStore((state) => state.workspaceDir);
  const scope = folder ?? NO_WORKSPACE;
  const bench = useWorkbenchStore((state) => state.byRoot[scope]) ?? SOLO;
  const terminals = useTerminals(bridge);
  const browser = useBrowserState(bridge);
  const container = React.useRef<HTMLDivElement>(null);
  // A browser page is a native view on top of the window and would swallow a drag.
  const [dragging, setDragging] = React.useState(false);
  const panelResizing = usePanelStore((state) => state.resizing);

  // Keeps the main area and the main process in step:
  // - a closed terminal or browser tab leaves it (only ids seen before count as closed, as a tab
  //   just opened may not have reached these lists yet);
  // - a browser tab nobody shows (a link that opened a new tab, or one left from before the window
  //   reloaded) opens as a tab, and so does a terminal of this workspace.
  const seen = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!terminals || !browser) return;
    const alive = new Set([
      ...terminals.map((terminal) => `terminal:${terminal.id}`),
      ...browser.tabs.map((page) => `browser:${page.id}`),
    ]);
    for (const key of alive) seen.current.add(key);
    const store = useWorkbenchStore.getState();
    store.prune(
      scope,
      (tab) => tab.kind === "file" || alive.has(tabKey(tab)) || !seen.current.has(tabKey(tab)),
    );
    const shownBrowsers = hostedIds(store.byRoot, "browser");
    for (const page of browser.tabs) {
      if (!shownBrowsers.has(page.id) && !closingTabs.has(page.id)) {
        store.add(scope, { kind: "browser", id: page.id });
      }
    }
    const shownTerminals = hostedIds(store.byRoot, "terminal");
    for (const terminal of terminals) {
      if (
        terminal.cwd === folder &&
        !shownTerminals.has(terminal.id) &&
        !closingTabs.has(terminal.id)
      ) {
        store.add(scope, { kind: "terminal", id: terminal.id }, false);
      }
    }
  }, [scope, folder, terminals, browser]);

  const hasFiles = bench.groups.some((group) => group.tabs.some((tab) => tab.kind === "file"));
  const resizing = dragging || panelResizing;
  return (
    <div ref={container} className="flex min-h-0 min-w-0 flex-1">
      <GroupView
        bridge={bridge}
        scope={scope}
        folder={folder}
        bench={bench}
        index={0}
        chat={chat}
        terminals={terminals}
        browser={browser}
        resizing={resizing}
      />
      {bench.groups.length > 1 && (
        <Divider container={container} scope={scope} split={bench.split} onResizing={setDragging} />
      )}
      {bench.groups.length > 1 && (
        <GroupView
          bridge={bridge}
          scope={scope}
          folder={folder}
          bench={bench}
          index={1}
          chat={null}
          terminals={terminals}
          browser={browser}
          resizing={resizing}
        />
      )}
      {folder && hasFiles && <FileWatch bridge={bridge} root={folder} />}
    </div>
  );
}
