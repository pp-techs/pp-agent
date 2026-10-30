import { create } from "zustand";

export const PANEL_TOOLS = ["files", "browser", "terminal"] as const;
export type PanelTool = (typeof PANEL_TOOLS)[number];

export const PANEL_WIDTH = { min: 320, default: 440, max: 1200 } as const;

const STORAGE_KEY = "pp-agent:side-panel";

interface PanelState {
  open: boolean;
  tool: PanelTool;
  width: number;
  /** The panel covers the chat instead of sitting beside it. */
  expanded: boolean;
  toggle: () => void;
  setExpanded: (expanded: boolean) => void;
  setOpen: (open: boolean) => void;
  /** Shows a tool, opening the panel. */
  show: (tool: PanelTool) => void;
  setWidth: (width: number) => void;
}

type Saved = Pick<PanelState, "open" | "tool" | "width" | "expanded">;

function load(): Saved {
  const fallback: Saved = {
    open: false,
    tool: "terminal",
    width: PANEL_WIDTH.default,
    expanded: false,
  };
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) return fallback;
    const value = raw as Partial<Record<keyof Saved, unknown>>;
    return {
      open: value.open === true,
      tool: PANEL_TOOLS.find((tool) => tool === value.tool) ?? fallback.tool,
      width: typeof value.width === "number" ? clampWidth(value.width) : fallback.width,
      expanded: value.expanded === true,
    };
  } catch {
    return fallback;
  }
}

function save(state: Saved): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        open: state.open,
        tool: state.tool,
        width: state.width,
        expanded: state.expanded,
      }),
    );
  } catch {
    // Storage is unavailable; the panel simply starts closed next time.
  }
}

export function clampWidth(width: number): number {
  return Math.round(Math.min(Math.max(width, PANEL_WIDTH.min), PANEL_WIDTH.max));
}

/** The right side panel: whether it is open, which tool it shows, and how wide it is. */
export const usePanelStore = create<PanelState>()((set, get) => {
  const update = (patch: Partial<Saved>) => {
    set(patch);
    save(get());
  };
  return {
    ...load(),
    toggle: () => update({ open: !get().open }),
    setExpanded: (expanded) => update({ expanded }),
    setOpen: (open) => update({ open }),
    show: (tool) => update({ open: true, tool }),
    setWidth: (width) => update({ width: clampWidth(width) }),
  };
});
