import type { RunSpan } from "@workspace/shared";
import { describe, expect, it } from "vite-plus/test";

import { COLUMN_LIMIT, layoutFlow } from "./flow-layout";

const span = (
  id: string,
  kind: RunSpan["kind"],
  parentId: string | undefined,
  startedAt: number,
  extra: Partial<RunSpan> = {},
): RunSpan => ({
  id,
  kind,
  name: id,
  status: "done",
  startedAt,
  endedAt: startedAt + 1,
  ...(parentId ? { parentId } : {}),
  ...extra,
});

/** request → step 1 → [read, delegate (2 helpers)] → step 2 → end */
const RUN: RunSpan[] = [
  span("r", "run", undefined, 0),
  span("a", "agent", "r", 0),
  span("s1", "step", "a", 1),
  span("read", "tool", "s1", 2),
  span("del", "tool", "s1", 2, { name: "delegate_task" }),
  span("h0", "agent", "del", 3),
  span("h0s", "step", "h0", 3),
  span("h0t", "tool", "h0s", 4),
  span("h1", "agent", "del", 3),
  span("h1s", "step", "h1", 3),
  span("s2", "step", "a", 9),
];

describe("layoutFlow", () => {
  it("lays the steps out left to right, with the calls of a step stacked between them", () => {
    const layout = layoutFlow(RUN);
    const x = (id: string) => layout.cards.find((card) => card.id === id)?.x ?? -1;
    expect(x("r")).toBeLessThan(x("s1"));
    expect(x("s1")).toBeLessThan(x("read"));
    expect(x("read")).toBeLessThan(x("s2"));
    expect(x("s2")).toBeLessThan(x("r#end"));
    const read = layout.cards.find((card) => card.id === "read");
    const group = layout.groups.find((item) => item.id === "del");
    expect(group?.x).toBe(read?.x);
    // Stacked, not overlapping.
    expect(
      group && read && (group.y >= read.y + read.height || read.y >= group.y + group.height),
    ).toBe(true);
  });

  it("puts the helpers of a delegate call in lanes inside its box, one above the other", () => {
    const layout = layoutFlow(RUN);
    const group = layout.groups.find((item) => item.id === "del");
    const h0 = layout.cards.find((card) => card.id === "h0");
    const h1 = layout.cards.find((card) => card.id === "h1");
    expect(h0?.depth).toBe(1);
    expect(h0 && h1 && h0.x === h1.x && h0.y < h1.y).toBe(true);
    for (const card of [h0, h1]) {
      expect(card && group && card.x >= group.x && card.y >= group.y).toBe(true);
      expect(card && group && card.y + card.height <= group.y + group.height).toBe(true);
    }
    // Helper steps follow their agent card.
    expect(layout.edges.some((edge) => edge.source === "h0" && edge.target === "h0s")).toBe(true);
  });

  it("fans out to the calls and helpers of a step and comes back together at the next one", () => {
    const { edges } = layoutFlow(RUN);
    const pairs = edges.map((edge) => `${edge.source}->${edge.target}`);
    expect(pairs).toEqual(
      expect.arrayContaining([
        "r->s1",
        "s1->read",
        "read->s2",
        // Into each helper lane, and back from each lane's last card.
        "s1->h0",
        "s1->h1",
        "h0t->s2",
        "h1s->s2",
        "s2->r#end",
      ]),
    );
  });

  it("has no end while the run goes on, and marks the edge into live work", () => {
    const live = RUN.map((item) =>
      item.id === "r" || item.id === "s2" ? { ...item, status: "running" as const } : item,
    );
    const layout = layoutFlow(live);
    expect(layout.cards.some((card) => card.role === "end")).toBe(false);
    expect(layout.edges.find((edge) => edge.target === "s2")?.live).toBe(true);
  });

  it("folds a long column into a '+N more' card until it is opened", () => {
    const many = [
      span("r", "run", undefined, 0),
      span("a", "agent", "r", 0),
      span("s", "step", "a", 1),
      ...Array.from({ length: 10 }, (_, n) => span(`t${n}`, "tool", "s", 2 + n)),
    ];
    const folded = layoutFlow(many);
    const more = folded.cards.find((card) => card.role === "more");
    expect(folded.cards.filter((card) => card.role === "tool")).toHaveLength(COLUMN_LIMIT - 1);
    expect(more?.hidden).toBe(10 - (COLUMN_LIMIT - 1));
    const open = layoutFlow(many, new Set([more?.column ?? ""]));
    expect(open.cards.filter((card) => card.role === "tool")).toHaveLength(10);
  });
});
