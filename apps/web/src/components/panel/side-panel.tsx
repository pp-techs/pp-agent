import * as React from "react";
import type { DesktopBridge } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Spinner } from "@workspace/ui/components/spinner";
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import {
  FolderTreeIcon,
  GlobeIcon,
  Maximize2Icon,
  Minimize2Icon,
  SquareTerminalIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { IS_MAC } from "@/hooks/use-panel-shortcut";
import { clampWidth, type PanelTool, PANEL_TOOLS, usePanelStore } from "@/stores/panel-store";

// Loaded when the panel first shows them: the terminal alone (xterm.js) is a few hundred KB.
const TerminalPanel = React.lazy(() =>
  import("@/components/panel/terminal-panel").then((module) => ({ default: module.TerminalPanel })),
);
const FilesPanel = React.lazy(() =>
  import("@/components/panel/files-panel").then((module) => ({ default: module.FilesPanel })),
);
const BrowserPanel = React.lazy(() =>
  import("@/components/panel/browser-panel").then((module) => ({ default: module.BrowserPanel })),
);

const TOOL_ICONS: Record<PanelTool, LucideIcon> = {
  terminal: SquareTerminalIcon,
  files: FolderTreeIcon,
  browser: GlobeIcon,
};

/** The chat keeps at least this much room when the panel is dragged wider. */
const MIN_CHAT_WIDTH = 420;

/** Drag handle on the panel's left edge. */
function ResizeHandle({ onResizing }: { onResizing: (resizing: boolean) => void }) {
  const { t } = useTranslation("chat");
  const setWidth = usePanelStore((state) => state.setWidth);
  const width = usePanelStore((state) => state.width);
  const drag = React.useRef<{ x: number; width: number } | null>(null);

  const resize = (next: number) =>
    setWidth(Math.min(clampWidth(next), Math.max(window.innerWidth - MIN_CHAT_WIDTH, 320)));

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("panel.resize")}
      tabIndex={0}
      className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize outline-none after:absolute after:inset-y-3 after:left-1/2 after:w-px after:-translate-x-1/2 hover:after:bg-border focus-visible:after:bg-ring"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width };
        onResizing(true);
      }}
      onPointerMove={(event) => {
        if (drag.current) resize(drag.current.width + drag.current.x - event.clientX);
      }}
      onPointerUp={() => {
        drag.current = null;
        onResizing(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        onResizing(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") resize(width + 24);
        else if (event.key === "ArrowRight") resize(width - 24);
      }}
    />
  );
}

/** The right side panel beside the chat: a terminal, the workspace's files, and a browser. */
export function SidePanel({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("chat");
  const open = usePanelStore((state) => state.open);
  const tool = usePanelStore((state) => state.tool);
  const width = usePanelStore((state) => state.width);
  const show = usePanelStore((state) => state.show);
  const setOpen = usePanelStore((state) => state.setOpen);
  const expanded = usePanelStore((state) => state.expanded);
  const setExpanded = usePanelStore((state) => state.setExpanded);
  // A browser page is a native view on top of the window and would swallow the drag.
  const [resizing, setResizing] = React.useState(false);
  if (!open) return null;

  const shortcut = IS_MAC ? "⌘J" : "Ctrl+J";
  return (
    <aside
      aria-label={t("panel.label")}
      style={expanded ? undefined : { width }}
      className={`relative hidden min-w-0 flex-col bg-background md:my-2 md:mr-2 md:flex md:h-[calc(100svh-(--spacing(4)))] md:rounded-2xl md:shadow-sm md:ring-1 md:ring-foreground/5 dark:md:ring-foreground/10 ${expanded ? "flex-1" : "shrink-0"}`}
    >
      {!expanded && <ResizeHandle onResizing={setResizing} />}
      <header className="flex h-12 shrink-0 items-center gap-2 px-2">
        <ToggleGroup
          spacing={0}
          value={[tool]}
          onValueChange={(value) => {
            const next = PANEL_TOOLS.find((candidate) => candidate === value[0]);
            if (next) show(next);
          }}
        >
          {PANEL_TOOLS.map((id) => {
            const Icon = TOOL_ICONS[id];
            return (
              <ToggleGroupItem key={id} value={id} size="sm" aria-label={t(`panel.tools.${id}`)}>
                <Icon />
                {t(`panel.tools.${id}`)}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-auto"
                aria-label={expanded ? t("panel.restore") : t("panel.expand")}
                aria-pressed={expanded}
                onClick={() => setExpanded(!expanded)}
              />
            }
          >
            {expanded ? <Minimize2Icon /> : <Maximize2Icon />}
          </TooltipTrigger>
          <TooltipContent>{expanded ? t("panel.restore") : t("panel.expand")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("panel.close")}
                onClick={() => setOpen(false)}
              />
            }
          >
            <XIcon />
          </TooltipTrigger>
          <TooltipContent>{t("panel.closeWithShortcut", { shortcut })}</TooltipContent>
        </Tooltip>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-2xl">
        <React.Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center">
              <Spinner />
            </div>
          }
        >
          {tool === "terminal" && <TerminalPanel bridge={bridge} />}
          {tool === "files" && <FilesPanel bridge={bridge} />}
          {tool === "browser" && <BrowserPanel bridge={bridge} hidden={resizing} />}
        </React.Suspense>
      </div>
    </aside>
  );
}
