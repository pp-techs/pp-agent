import type { DesktopBridge } from "@workspace/shared";
import { Spinner } from "@workspace/ui/components/spinner";
import * as React from "react";
import { useTranslation } from "react-i18next";

import { clampWidth, usePanelStore } from "@/stores/panel-store";

// Loaded when the panel first opens: the file views are a sizeable chunk.
const FilesPanel = React.lazy(() =>
  import("@/components/panel/files-panel").then((module) => ({ default: module.FilesPanel })),
);

/** The chat area keeps at least this much room when the panel is dragged wider. */
const MIN_MAIN_WIDTH = 420;

/** Drag handle on the panel's left edge. */
function ResizeHandle() {
  const { t } = useTranslation("chat");
  const setWidth = usePanelStore((state) => state.setWidth);
  const dragWidth = usePanelStore((state) => state.dragWidth);
  const setResizing = usePanelStore((state) => state.setResizing);
  const width = usePanelStore((state) => state.width);
  const drag = React.useRef<{ x: number; width: number } | null>(null);

  const fit = (next: number) =>
    Math.min(clampWidth(next), Math.max(window.innerWidth - MIN_MAIN_WIDTH, 280));
  // The width is saved once the drag ends, not on every move.
  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    setWidth(usePanelStore.getState().width);
    setResizing(false);
  };

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
        setResizing(true);
      }}
      onPointerMove={(event) => {
        if (drag.current) dragWidth(fit(drag.current.width + drag.current.x - event.clientX));
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") setWidth(fit(width + 24));
        else if (event.key === "ArrowRight") setWidth(fit(width - 24));
      }}
    />
  );
}

/**
 * The right side panel beside the main area: the open workspace's file tree. Files open as tabs of
 * the main area; terminals and browser tabs have no place here.
 */
export function SidePanel({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("chat");
  const open = usePanelStore((state) => state.open);
  const width = usePanelStore((state) => state.width);
  if (!open) return null;

  return (
    <aside
      aria-label={t("panel.label")}
      // A width saved on a larger screen must not squeeze the main area out of a smaller window.
      style={{ width, maxWidth: `calc(100vw - ${MIN_MAIN_WIDTH}px)` }}
      className="relative hidden min-w-0 shrink-0 flex-col bg-background md:my-2 md:mr-2 md:flex md:h-[calc(100svh-(--spacing(4)))] md:rounded-2xl md:shadow-sm"
    >
      <ResizeHandle />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
        <React.Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center">
              <Spinner />
            </div>
          }
        >
          <FilesPanel bridge={bridge} />
        </React.Suspense>
      </div>
    </aside>
  );
}
