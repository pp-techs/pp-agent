import { create } from "zustand";

/** What a tab of the main area shows. The content itself lives elsewhere (see below). */
export type CenterTab =
  | { kind: "chat" }
  | { kind: "file"; path: string }
  | { kind: "terminal"; id: string }
  | { kind: "browser"; id: string };

export const CHAT_TAB: CenterTab = { kind: "chat" };

/** The key of the main area of a conversation without a workspace folder: it holds browser tabs only. */
export const NO_WORKSPACE = "";

/** A tab's identity within a workspace's main area. */
export function tabKey(tab: CenterTab): string {
  switch (tab.kind) {
    case "chat":
      return "chat";
    case "file":
      return `file:${tab.path}`;
    case "terminal":
      return `terminal:${tab.id}`;
    case "browser":
      return `browser:${tab.id}`;
  }
}

/** One area of the main area: a row of tabs and the one showing. */
export interface TabGroup {
  tabs: CenterTab[];
  /** The `tabKey` of the tab showing. */
  active: string;
}

/**
 * The main area of one workspace: the chat, plus the files, terminals and browser tabs the person
 * moved here from the side panel, in one or two side-by-side groups. The chat is always the first
 * tab of the first group. The tabs only point at their content: files are paths in the workspace,
 * terminals and browser tabs live in the main process.
 */
export interface Workbench {
  groups: TabGroup[];
  /** The group that new tabs go to and Cmd+W closes in. */
  focused: number;
  /** Share of the width the first group takes while there are two. */
  split: number;
}

export const SPLIT = { min: 0.2, max: 0.8, default: 0.5 } as const;

/** What a workspace without a main-area layout has: the chat alone. */
export const SOLO: Workbench = {
  groups: [{ tabs: [CHAT_TAB], active: "chat" }],
  focused: 0,
  split: SPLIT.default,
};

interface WorkbenchState {
  byRoot: Record<string, Workbench>;
  /**
   * Adds a tab to the focused group and shows it, or shows it where it already is (`activate`
   * false adds it behind the tab showing, and leaves a tab already there alone). A browser tab
   * belongs to one workspace at a time, so it leaves the others.
   */
  add: (root: string, tab: CenterTab, activate?: boolean) => void;
  /** Removes a tab from the main area; the chat stays. */
  close: (root: string, key: string) => void;
  activate: (root: string, group: number, key: string) => void;
  focus: (root: string, group: number) => void;
  /** Moves a tab to the other group, opening the second one if there is none. */
  moveToOther: (root: string, key: string) => void;
  setSplit: (root: string, split: number) => void;
  /** A file or folder was renamed: its tabs follow it. */
  renameFile: (root: string, from: string, to: string) => void;
  /** A file or folder is gone: its tabs close (those of the files inside, for a folder). */
  forgetFile: (root: string, path: string) => void;
  /** Drops tabs whose terminal or browser tab no longer exists. */
  prune: (root: string, keep: (tab: CenterTab) => boolean) => void;
}

export function clampSplit(split: number): number {
  return Math.min(Math.max(split, SPLIT.min), SPLIT.max);
}

function locate(bench: Workbench, key: string): { group: number; index: number } | null {
  for (const [group, { tabs }] of bench.groups.entries()) {
    const index = tabs.findIndex((tab) => tabKey(tab) === key);
    if (index >= 0) return { group, index };
  }
  return null;
}

/** The tab to show after `index` leaves a group: its neighbour, preferably the next one. */
function nextActive(tabs: CenterTab[], index: number): string {
  const tab = tabs[index] ?? tabs[index - 1];
  return tab ? tabKey(tab) : "chat";
}

function withoutTab(bench: Workbench, key: string): Workbench {
  const found = locate(bench, key);
  if (!found || key === "chat") return bench;
  const groups = bench.groups.map((group, index) => {
    if (index !== found.group) return group;
    const tabs = group.tabs.filter((tab) => tabKey(tab) !== key);
    return { tabs, active: group.active === key ? nextActive(tabs, found.index) : group.active };
  });
  // The second group goes away with its last tab.
  const kept = groups.filter((group, index) => index === 0 || group.tabs.length > 0);
  return { ...bench, groups: kept, focused: Math.min(bench.focused, kept.length - 1) };
}

function withTab(
  bench: Workbench,
  tab: CenterTab,
  groupIndex: number,
  activate: boolean,
): Workbench {
  const key = tabKey(tab);
  const groups = [...bench.groups];
  while (groups.length <= groupIndex) groups.push({ tabs: [], active: key });
  groups[groupIndex] = {
    tabs: [...groups[groupIndex].tabs, tab],
    active: activate ? key : groups[groupIndex].active,
  };
  return { ...bench, groups, focused: activate ? groupIndex : bench.focused };
}

export const useWorkbenchStore = create<WorkbenchState>()((set, get) => {
  const update = (root: string, change: (bench: Workbench) => Workbench) =>
    set((state) => {
      const current = state.byRoot[root] ?? SOLO;
      const next = change(current);
      return next === current ? state : { byRoot: { ...state.byRoot, [root]: next } };
    });
  return {
    byRoot: {},
    add: (root, tab, activate = true) => {
      const key = tabKey(tab);
      if (tab.kind === "browser") {
        for (const other of Object.keys(get().byRoot)) {
          if (other !== root) update(other, (bench) => withoutTab(bench, key));
        }
      }
      update(root, (bench) => {
        const found = locate(bench, key);
        if (found) {
          if (!activate) return bench;
          const groups = bench.groups.map((group, index) =>
            index === found.group ? { ...group, active: key } : group,
          );
          return { ...bench, groups, focused: found.group };
        }
        return withTab(bench, tab, bench.focused, activate);
      });
    },
    close: (root, key) => update(root, (bench) => withoutTab(bench, key)),
    activate: (root, group, key) =>
      update(root, (bench) => ({
        ...bench,
        groups: bench.groups.map((item, index) =>
          index === group ? { ...item, active: key } : item,
        ),
        focused: group,
      })),
    focus: (root, group) =>
      update(root, (bench) => (bench.focused === group ? bench : { ...bench, focused: group })),
    moveToOther: (root, key) =>
      update(root, (bench) => {
        const found = locate(bench, key);
        const tab = found && bench.groups[found.group].tabs[found.index];
        if (!found || !tab || key === "chat") return bench;
        const target = found.group === 0 ? 1 : 0;
        return withTab(withoutTab(bench, key), tab, target, true);
      }),
    setSplit: (root, split) => update(root, (bench) => ({ ...bench, split: clampSplit(split) })),
    renameFile: (root, from, to) =>
      update(root, (bench) => {
        const remap = (path: string) =>
          path === from || path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
        return {
          ...bench,
          groups: bench.groups.map((group) => {
            const tabs = group.tabs.map((tab) =>
              tab.kind === "file" ? { ...tab, path: remap(tab.path) } : tab,
            );
            const active = group.active.startsWith("file:")
              ? tabKey({ kind: "file", path: remap(group.active.slice(5)) })
              : group.active;
            return { tabs, active };
          }),
        };
      }),
    forgetFile: (root, path) =>
      update(root, (bench) => {
        const gone = (tab: CenterTab) =>
          tab.kind === "file" && (tab.path === path || tab.path.startsWith(`${path}/`));
        return bench.groups
          .flatMap((group) => group.tabs.filter(gone))
          .reduce((next, tab) => withoutTab(next, tabKey(tab)), bench);
      }),
    prune: (root, keep) =>
      update(root, (bench) =>
        bench.groups
          .flatMap((group) => group.tabs.filter((tab) => tab.kind !== "chat" && !keep(tab)))
          .reduce((next, tab) => withoutTab(next, tabKey(tab)), bench),
      ),
  };
});

/** Ids of the tabs of one kind the main area of any workspace shows. */
export function hostedIds(
  byRoot: Record<string, Workbench>,
  kind: "terminal" | "browser",
): Set<string> {
  const ids = new Set<string>();
  for (const bench of Object.values(byRoot)) {
    for (const group of bench.groups) {
      for (const tab of group.tabs) if (tab.kind === kind) ids.add(tab.id);
    }
  }
  return ids;
}

/** The workspace whose main area shows a browser tab. */
export function browserHost(byRoot: Record<string, Workbench>, id: string): string | null {
  for (const [root, bench] of Object.entries(byRoot)) {
    if (locate(bench, `browser:${id}`)) return root;
  }
  return null;
}
