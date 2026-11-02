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
  /** A file or folder was renamed: its tabs and expanded folders follow it. */
  rename: (root: string, from: string, to: string) => void;
  /** A file or folder is gone: its tabs close (those of the files inside, for a folder). */
  forget: (root: string, path: string) => void;
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
    rename: (root, from, to) =>
      update(root, (tabs) => {
        const remap = (path: string) =>
          path === from || path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
        return {
          open: tabs.open.map(remap),
          active: tabs.active === null ? null : remap(tabs.active),
          expanded: tabs.expanded.map(remap),
        };
      }),
    forget: (root, path) =>
      update(root, (tabs) => {
        const gone = (item: string) => item === path || item.startsWith(`${path}/`);
        const open = tabs.open.filter((item) => !gone(item));
        const active =
          tabs.active !== null && gone(tabs.active)
            ? (open[Math.min(tabs.open.findIndex(gone), open.length - 1)] ?? null)
            : tabs.active;
        return { open, active, expanded: tabs.expanded.filter((item) => !gone(item)) };
      }),
    toggleFolder: (root, path) =>
      update(root, (tabs) => ({
        ...tabs,
        expanded: tabs.expanded.includes(path)
          ? tabs.expanded.filter((item) => item !== path)
          : [...tabs.expanded, path],
      })),
  };
});
