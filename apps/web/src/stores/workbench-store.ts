import { create } from "zustand";

/** What a tab of the main area shows. The content itself lives elsewhere (see below). */
export type CenterTab =
  | { kind: "chat" }
  | { kind: "file"; root: string; path: string }
  | { kind: "terminal"; id: string }
  | { kind: "browser"; id: string }
  /** The conversation's runs: agents, helpers and tool calls as a graph and a timeline. */
  | { kind: "run" };

export const CHAT_TAB: CenterTab = { kind: "chat" };

/** The key of a conversation without a session file (a temporary one, or one not yet known). */
export const NO_SESSION = "";

/** A tab's identity within a conversation's main area. */
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
    case "run":
      return "run";
  }
}

/** One area of the main area: a row of tabs and the one showing. */
export interface TabGroup {
  tabs: CenterTab[];
  /** The `tabKey` of the tab showing. */
  active: string;
}

/**
 * The main area of one conversation (keyed by its session file): the chat, plus the files,
 * terminals and browser tabs that open there, in one or two side-by-side groups. The chat is always
 * the first tab of the first group. The tabs only point at their content: files are paths in the
 * workspace, terminals and browser tabs live in the main process, which also tells whose they are.
 */
export interface Workbench {
  groups: TabGroup[];
  /** The group that new tabs go to and Cmd+W closes in. */
  focused: number;
  /** Share of the width the first group takes while there are two. */
  split: number;
}

export const SPLIT = { min: 0.2, max: 0.8, default: 0.5 } as const;

/** What a conversation without a main-area layout has: the chat alone. */
export const SOLO: Workbench = {
  groups: [{ tabs: [CHAT_TAB], active: "chat" }],
  focused: 0,
  split: SPLIT.default,
};

interface WorkbenchState {
  bySession: Record<string, Workbench>;
  /**
   * Adds a tab to the focused group and shows it, or shows it where it already is (`activate`
   * false adds it behind the tab showing, and leaves a tab already there alone).
   */
  add: (session: string, tab: CenterTab, activate?: boolean) => void;
  /** Removes a tab from the main area; the chat stays. */
  close: (session: string, key: string) => void;
  activate: (session: string, group: number, key: string) => void;
  focus: (session: string, group: number) => void;
  /** Moves a tab to the other group, opening the second one if there is none. */
  moveToOther: (session: string, key: string) => void;
  setSplit: (session: string, split: number) => void;
  /** The conversation is gone: so is its main area. */
  forgetSession: (session: string) => void;
  /** A file or folder of a workspace was renamed: its tabs, in every conversation, follow it. */
  renameFile: (root: string, from: string, to: string) => void;
  /** A file or folder of a workspace is gone: its tabs close (those of the files inside, for a folder). */
  forgetFile: (root: string, path: string) => void;
  /** Drops tabs whose terminal or browser tab no longer exists. */
  prune: (session: string, keep: (tab: CenterTab) => boolean) => void;
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

export const useWorkbenchStore = create<WorkbenchState>()((set) => {
  const update = (session: string, change: (bench: Workbench) => Workbench) =>
    set((state) => {
      const current = state.bySession[session] ?? SOLO;
      const next = change(current);
      return next === current ? state : { bySession: { ...state.bySession, [session]: next } };
    });
  /** Applies a change to the main area of every conversation (the files of a workspace are in many). */
  const updateAll = (change: (bench: Workbench) => Workbench) =>
    set((state) => {
      const entries = Object.entries(state.bySession).map(
        ([session, bench]) => [session, change(bench)] as const,
      );
      return entries.some(([session, bench]) => bench !== state.bySession[session])
        ? { bySession: Object.fromEntries(entries) }
        : state;
    });
  return {
    bySession: {},
    add: (session, tab, activate = true) => {
      const key = tabKey(tab);
      update(session, (bench) => {
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
    close: (session, key) => update(session, (bench) => withoutTab(bench, key)),
    activate: (session, group, key) =>
      update(session, (bench) => ({
        ...bench,
        groups: bench.groups.map((item, index) =>
          index === group ? { ...item, active: key } : item,
        ),
        focused: group,
      })),
    focus: (session, group) =>
      update(session, (bench) => (bench.focused === group ? bench : { ...bench, focused: group })),
    moveToOther: (session, key) =>
      update(session, (bench) => {
        const found = locate(bench, key);
        const tab = found && bench.groups[found.group].tabs[found.index];
        if (!found || !tab || key === "chat") return bench;
        const target = found.group === 0 ? 1 : 0;
        return withTab(withoutTab(bench, key), tab, target, true);
      }),
    setSplit: (session, split) =>
      update(session, (bench) => ({ ...bench, split: clampSplit(split) })),
    forgetSession: (session) =>
      set((state) => {
        if (!(session in state.bySession)) return state;
        const { [session]: _gone, ...rest } = state.bySession;
        return { bySession: rest };
      }),
    renameFile: (root, from, to) =>
      updateAll((bench) => {
        const remap = (tab: CenterTab): CenterTab =>
          tab.kind === "file" &&
          tab.root === root &&
          (tab.path === from || tab.path.startsWith(`${from}/`))
            ? { ...tab, path: to + tab.path.slice(from.length) }
            : tab;
        if (!bench.groups.some((group) => group.tabs.some((tab) => remap(tab) !== tab))) {
          return bench;
        }
        return {
          ...bench,
          groups: bench.groups.map((group) => {
            const tabs = group.tabs.map(remap);
            const showing = group.tabs.findIndex((tab) => tabKey(tab) === group.active);
            return { tabs, active: showing >= 0 ? tabKey(tabs[showing]) : group.active };
          }),
        };
      }),
    forgetFile: (root, path) =>
      updateAll((bench) => {
        const gone = (tab: CenterTab) =>
          tab.kind === "file" &&
          tab.root === root &&
          (tab.path === path || tab.path.startsWith(`${path}/`));
        return bench.groups
          .flatMap((group) => group.tabs.filter(gone))
          .reduce((next, tab) => withoutTab(next, tabKey(tab)), bench);
      }),
    prune: (session, keep) =>
      update(session, (bench) =>
        bench.groups
          .flatMap((group) => group.tabs.filter((tab) => tab.kind !== "chat" && !keep(tab)))
          .reduce((next, tab) => withoutTab(next, tabKey(tab)), bench),
      ),
  };
});
