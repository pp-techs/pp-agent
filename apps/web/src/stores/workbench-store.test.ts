import { beforeEach, describe, expect, it } from "vite-plus/test";

import { tabKey, useWorkbenchStore, type Workbench } from "./workbench-store";

const WORKSPACE = "/work/a";
const SESSION = "/sessions/a.jsonl";
const store = () => useWorkbenchStore.getState();
const file = (path: string, root = WORKSPACE) => ({ kind: "file" as const, root, path });
const bench = (session = SESSION): Workbench => {
  const found = store().bySession[session];
  if (!found) throw new Error("no layout");
  return found;
};
const keys = (group: number, session = SESSION) => bench(session).groups[group].tabs.map(tabKey);

beforeEach(() => useWorkbenchStore.setState({ bySession: {} }));

describe("workbench store", () => {
  it("keeps one Run tab per conversation, and a prune of closed tabs leaves it", () => {
    store().add(SESSION, { kind: "run" });
    store().add(SESSION, { kind: "terminal", id: "t1" });
    store().add(SESSION, { kind: "run" });
    expect(keys(0)).toEqual(["chat", "run", "terminal:t1"]);
    store().prune(SESSION, (tab) => tab.kind === "run");
    expect(keys(0)).toEqual(["chat", "run"]);
  });

  it("shows an added tab, and an added tab again where it already is", () => {
    store().add(SESSION, file("a.md"));
    store().add(SESSION, { kind: "terminal", id: "t1" });
    store().add(SESSION, file("a.md"));
    expect(keys(0)).toEqual(["chat", "file:a.md", "terminal:t1"]);
    expect(bench().groups[0].active).toBe("file:a.md");
  });

  it("opens a second group for a moved tab and closes it with its last tab", () => {
    store().add(SESSION, file("a.md"));
    store().add(SESSION, file("b.md"));
    store().moveToOther(SESSION, "file:b.md");
    expect(keys(0)).toEqual(["chat", "file:a.md"]);
    expect(keys(1)).toEqual(["file:b.md"]);
    expect(bench().focused).toBe(1);

    store().close(SESSION, "file:b.md");
    expect(bench().groups).toHaveLength(1);
    expect(bench().focused).toBe(0);
  });

  it("moves a tab back to the first group and drops the emptied second one", () => {
    store().add(SESSION, file("a.md"));
    store().moveToOther(SESSION, "file:a.md");
    store().moveToOther(SESSION, "file:a.md");
    expect(bench().groups).toHaveLength(1);
    expect(keys(0)).toEqual(["chat", "file:a.md"]);
  });

  it("never moves or closes the chat", () => {
    store().add(SESSION, file("a.md"));
    store().moveToOther(SESSION, "chat");
    store().close(SESSION, "chat");
    expect(bench().groups).toHaveLength(1);
    expect(keys(0)).toContain("chat");
  });

  it("falls back to a neighbour when the tab showing closes", () => {
    store().add(SESSION, file("a.md"));
    store().add(SESSION, file("b.md"));
    store().close(SESSION, "file:b.md");
    expect(bench().groups[0].active).toBe("file:a.md");
    store().close(SESSION, "file:a.md");
    expect(bench().groups[0].active).toBe("chat");
  });

  it("keeps the tabs of each conversation to itself, also in one workspace", () => {
    const other = "/sessions/b.jsonl";
    store().add(SESSION, { kind: "browser", id: "tab-1" });
    store().add(other, { kind: "terminal", id: "t1" });
    expect(keys(0)).toEqual(["chat", "browser:tab-1"]);
    expect(keys(0, other)).toEqual(["chat", "terminal:t1"]);

    store().forgetSession(SESSION);
    expect(store().bySession[SESSION]).toBeUndefined();
    expect(keys(0, other)).toEqual(["chat", "terminal:t1"]);
  });

  it("follows a renamed folder and drops a deleted one, in every conversation of the workspace", () => {
    const other = "/sessions/b.jsonl";
    const elsewhere = "/sessions/c.jsonl";
    store().add(SESSION, file("docs/a.md"));
    store().add(SESSION, file("docs/b.md"));
    store().add(other, file("docs/a.md"));
    store().add(elsewhere, file("docs/a.md", "/work/b"));

    store().renameFile(WORKSPACE, "docs", "notes");
    expect(keys(0)).toEqual(["chat", "file:notes/a.md", "file:notes/b.md"]);
    expect(bench().groups[0].active).toBe("file:notes/b.md");
    expect(keys(0, other)).toEqual(["chat", "file:notes/a.md"]);
    // The same path in another workspace is another file.
    expect(keys(0, elsewhere)).toEqual(["chat", "file:docs/a.md"]);

    store().forgetFile(WORKSPACE, "notes");
    expect(keys(0)).toEqual(["chat"]);
    expect(keys(0, other)).toEqual(["chat"]);
    expect(keys(0, elsewhere)).toEqual(["chat", "file:docs/a.md"]);
  });

  it("adds a tab behind the one showing, and leaves a tab already there alone", () => {
    store().add(SESSION, file("a.md"));
    store().add(SESSION, { kind: "terminal", id: "t1" }, false);
    expect(keys(0)).toEqual(["chat", "file:a.md", "terminal:t1"]);
    expect(bench().groups[0].active).toBe("file:a.md");
    store().add(SESSION, { kind: "terminal", id: "t1" }, false);
    expect(bench().groups[0].active).toBe("file:a.md");
  });

  it("prunes the tabs a predicate refuses", () => {
    store().add(SESSION, { kind: "terminal", id: "t1" });
    store().add(SESSION, { kind: "terminal", id: "t2" });
    store().prune(SESSION, (tab) => tab.kind !== "terminal" || tab.id === "t2");
    expect(keys(0)).toEqual(["chat", "terminal:t2"]);
  });
});
