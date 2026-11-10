import { beforeEach, describe, expect, it } from "vite-plus/test";

import { tabKey, useWorkbenchStore, type Workbench } from "./workbench-store";

const ROOT = "/work/a";
const store = () => useWorkbenchStore.getState();
const bench = (root = ROOT): Workbench => {
  const found = store().byRoot[root];
  if (!found) throw new Error("no layout");
  return found;
};
const keys = (group: number, root = ROOT) => bench(root).groups[group].tabs.map(tabKey);

beforeEach(() => useWorkbenchStore.setState({ byRoot: {} }));

describe("workbench store", () => {
  it("shows an added tab, and an added tab again where it already is", () => {
    store().add(ROOT, { kind: "file", path: "a.md" });
    store().add(ROOT, { kind: "terminal", id: "t1" });
    store().add(ROOT, { kind: "file", path: "a.md" });
    expect(keys(0)).toEqual(["chat", "file:a.md", "terminal:t1"]);
    expect(bench().groups[0].active).toBe("file:a.md");
  });

  it("opens a second group for a moved tab and closes it with its last tab", () => {
    store().add(ROOT, { kind: "file", path: "a.md" });
    store().add(ROOT, { kind: "file", path: "b.md" });
    store().moveToOther(ROOT, "file:b.md");
    expect(keys(0)).toEqual(["chat", "file:a.md"]);
    expect(keys(1)).toEqual(["file:b.md"]);
    expect(bench().focused).toBe(1);

    store().close(ROOT, "file:b.md");
    expect(bench().groups).toHaveLength(1);
    expect(bench().focused).toBe(0);
  });

  it("moves a tab back to the first group and drops the emptied second one", () => {
    store().add(ROOT, { kind: "file", path: "a.md" });
    store().moveToOther(ROOT, "file:a.md");
    store().moveToOther(ROOT, "file:a.md");
    expect(bench().groups).toHaveLength(1);
    expect(keys(0)).toEqual(["chat", "file:a.md"]);
  });

  it("never moves or closes the chat", () => {
    store().add(ROOT, { kind: "file", path: "a.md" });
    store().moveToOther(ROOT, "chat");
    store().close(ROOT, "chat");
    expect(bench().groups).toHaveLength(1);
    expect(keys(0)).toContain("chat");
  });

  it("falls back to a neighbour when the tab showing closes", () => {
    store().add(ROOT, { kind: "file", path: "a.md" });
    store().add(ROOT, { kind: "file", path: "b.md" });
    store().close(ROOT, "file:b.md");
    expect(bench().groups[0].active).toBe("file:a.md");
    store().close(ROOT, "file:a.md");
    expect(bench().groups[0].active).toBe("chat");
  });

  it("keeps a browser tab in one workspace at a time", () => {
    store().add(ROOT, { kind: "browser", id: "tab-1" });
    store().add("/work/b", { kind: "browser", id: "tab-1" });
    expect(keys(0, "/work/b")).toContain("browser:tab-1");
    expect(keys(0)).not.toContain("browser:tab-1");
  });

  it("follows a renamed folder and drops a deleted one", () => {
    store().add(ROOT, { kind: "file", path: "docs/a.md" });
    store().add(ROOT, { kind: "file", path: "docs/b.md" });
    store().renameFile(ROOT, "docs", "notes");
    expect(keys(0)).toEqual(["chat", "file:notes/a.md", "file:notes/b.md"]);
    expect(bench().groups[0].active).toBe("file:notes/b.md");

    store().forgetFile(ROOT, "notes");
    expect(keys(0)).toEqual(["chat"]);
  });

  it("adds a tab behind the one showing, and leaves a tab already there alone", () => {
    store().add(ROOT, { kind: "file", path: "a.md" });
    store().add(ROOT, { kind: "terminal", id: "t1" }, false);
    expect(keys(0)).toEqual(["chat", "file:a.md", "terminal:t1"]);
    expect(bench().groups[0].active).toBe("file:a.md");
    store().add(ROOT, { kind: "terminal", id: "t1" }, false);
    expect(bench().groups[0].active).toBe("file:a.md");
  });

  it("prunes the tabs a predicate refuses", () => {
    store().add(ROOT, { kind: "terminal", id: "t1" });
    store().add(ROOT, { kind: "terminal", id: "t2" });
    store().prune(ROOT, (tab) => tab.kind !== "terminal" || tab.id === "t2");
    expect(keys(0)).toEqual(["chat", "terminal:t2"]);
  });
});
