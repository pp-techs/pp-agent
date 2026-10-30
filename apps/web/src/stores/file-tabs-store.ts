import { create } from "zustand";

/** Files opened as tabs in one workspace, and its folders expanded in the tree. */
export interface WorkspaceFileTabs {
  /** Paths relative to the workspace folder, in tab order. */
  open: string[];
  /** The file tab shown; null shows the folder tree. */
  active: string | null;
  expanded: string[];
}

/** Older tabs close first beyond this many. */
const MAX_TABS = 20;

export const NO_FILE_TABS: WorkspaceFileTabs = { open: [], active: null, expanded: [] };

interface FileTabsState {
  byRoot: Record<string, WorkspaceFileTabs>;
  /** Opens a file as a tab (or shows its tab). */
  open: (root: string, path: string) => void;
  close: (root: string, path: string) => void;
  /** Shows a file tab, or the folder tree for null. */
  activate: (root: string, path: string | null) => void;
  toggleFolder: (root: string, path: string) => void;
}

/**
 * Kept outside the Files tool so its tabs and tree survive switching tools and conversations;
 * per workspace folder, for the life of the window.
 */
export const useFileTabsStore = create<FileTabsState>()((set) => {
  const update = (root: string, change: (tabs: WorkspaceFileTabs) => WorkspaceFileTabs) =>
    set((state) => ({
      byRoot: { ...state.byRoot, [root]: change(state.byRoot[root] ?? NO_FILE_TABS) },
    }));
  return {
    byRoot: {},
    open: (root, path) =>
      update(root, (tabs) => ({
        ...tabs,
        open: tabs.open.includes(path) ? tabs.open : [...tabs.open, path].slice(-MAX_TABS),
        active: path,
      })),
    close: (root, path) =>
      update(root, (tabs) => {
        const index = tabs.open.indexOf(path);
        const open = tabs.open.filter((item) => item !== path);
        const active =
          tabs.active === path ? (open[index] ?? open[index - 1] ?? null) : tabs.active;
        return { ...tabs, open, active };
      }),
    activate: (root, path) => update(root, (tabs) => ({ ...tabs, active: path })),
    toggleFolder: (root, path) =>
      update(root, (tabs) => ({
        ...tabs,
        expanded: tabs.expanded.includes(path)
          ? tabs.expanded.filter((item) => item !== path)
          : [...tabs.expanded, path],
      })),
  };
});
