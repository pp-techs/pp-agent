import { create } from "zustand";

import { useWorkbenchStore } from "@/stores/workbench-store";

interface FileTreeState {
  /** Folders expanded in the tree of each workspace, as paths relative to its folder. */
  expanded: Record<string, string[]>;
  toggleFolder: (root: string, path: string) => void;
  /**
   * A file or folder was renamed: its expanded folders and its tabs in the main area follow it.
   */
  rename: (root: string, from: string, to: string) => void;
  /** A file or folder is gone: its expanded folders and its tabs in the main area go too. */
  forget: (root: string, path: string) => void;
}

export const NO_FOLDERS: string[] = [];

/** The file tree's expanded folders, per workspace folder, for the life of the window. */
export const useFileTreeStore = create<FileTreeState>()((set) => {
  const update = (root: string, change: (folders: string[]) => string[]) =>
    set((state) => ({
      expanded: { ...state.expanded, [root]: change(state.expanded[root] ?? NO_FOLDERS) },
    }));
  return {
    expanded: {},
    toggleFolder: (root, path) =>
      update(root, (folders) =>
        folders.includes(path) ? folders.filter((item) => item !== path) : [...folders, path],
      ),
    rename: (root, from, to) => {
      useWorkbenchStore.getState().renameFile(root, from, to);
      update(root, (folders) =>
        folders.map((path) =>
          path === from || path.startsWith(`${from}/`) ? to + path.slice(from.length) : path,
        ),
      );
    },
    forget: (root, path) => {
      useWorkbenchStore.getState().forgetFile(root, path);
      update(root, (folders) =>
        folders.filter((item) => item !== path && !item.startsWith(`${path}/`)),
      );
    },
  };
});
