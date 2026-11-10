import { create } from "zustand";

export const PANEL_WIDTH = { min: 280, default: 320, max: 800 } as const;

const STORAGE_KEY = "pp-agent:side-panel";

interface PanelState {
  open: boolean;
  width: number;
  /** The panel's edge is being dragged: browser pages hide, as a native view would swallow the drag. */
  resizing: boolean;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  setWidth: (width: number) => void;
  /** Follows a drag of the panel's edge without saving; `setWidth` saves when the drag ends. */
  dragWidth: (width: number) => void;
  setResizing: (resizing: boolean) => void;
}

type Saved = Pick<PanelState, "open" | "width">;

function load(): Saved {
  const fallback: Saved = { open: false, width: PANEL_WIDTH.default };
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) return fallback;
    const value = raw as Partial<Record<keyof Saved, unknown>>;
    return {
      open: value.open === true,
      width: typeof value.width === "number" ? clampWidth(value.width) : fallback.width,
    };
  } catch {
    return fallback;
  }
}

function save(state: Saved): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ open: state.open, width: state.width }));
  } catch {
    // Storage is unavailable; the panel simply starts closed next time.
  }
}

export function clampWidth(width: number): number {
  return Math.round(Math.min(Math.max(width, PANEL_WIDTH.min), PANEL_WIDTH.max));
}

/** The right side panel (the workspace's file tree): whether it is open, and how wide. */
export const usePanelStore = create<PanelState>()((set, get) => {
  const update = (patch: Partial<Saved>) => {
    set(patch);
    save(get());
  };
  return {
    ...load(),
    resizing: false,
    toggle: () => update({ open: !get().open }),
    setOpen: (open) => update({ open }),
    setWidth: (width) => update({ width: clampWidth(width) }),
    // Saving writes to storage synchronously, too slow for every pointer move.
    dragWidth: (width) => set({ width: clampWidth(width) }),
    setResizing: (resizing) => set({ resizing }),
  };
});
