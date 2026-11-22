import { RUN_TRACE_LIMITS, type RunSpan } from "@workspace/shared";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { hasLiveRun, spansOfRun, useRunStore } from "./run-store";

const SESSION = "/sessions/a.jsonl";
const store = () => useRunStore.getState();
const span = (
  id: string,
  kind: RunSpan["kind"],
  parentId?: string,
  extra: Partial<RunSpan> = {},
): RunSpan => ({
  id,
  kind,
  name: id,
  status: "running",
  startedAt: 0,
  ...(parentId ? { parentId } : {}),
  ...extra,
});

beforeEach(() => useRunStore.setState({ bySession: {} }));

describe("run store", () => {
  it("upserts spans and lists a run's spans, its own first", () => {
    store().apply(SESSION, [
      span("r1", "run"),
      span("r1/a", "agent", "r1"),
      span("t1", "tool", "r1/a", { startedAt: 5 }),
    ]);
    store().apply(SESSION, [{ ...span("t1", "tool", "r1/a"), status: "done", endedAt: 9 }]);
    const trace = store().bySession[SESSION];
    expect(trace?.runs).toEqual(["r1"]);
    expect(trace?.spans.t1).toMatchObject({ status: "done", endedAt: 9 });
    expect(spansOfRun(trace!, "r1").map((item) => item.id)).toEqual(["r1", "r1/a", "t1"]);
    expect(hasLiveRun(trace)).toBe(true);
  });

  it("drops the oldest runs and their spans", () => {
    for (let n = 0; n <= RUN_TRACE_LIMITS.runs; n++)
      store().apply(SESSION, [
        span(`r${n}`, "run", undefined, { status: "done" }),
        span(`r${n}/a`, "agent", `r${n}`),
      ]);
    const trace = store().bySession[SESSION]!;
    expect(trace.runs).toHaveLength(RUN_TRACE_LIMITS.runs);
    expect(trace.spans.r0).toBeUndefined();
    expect(trace.spans["r0/a"]).toBeUndefined();
    expect(trace.spans["r1/a"]).toBeDefined();
    expect(hasLiveRun(trace)).toBe(false);
  });

  it("forgets a conversation", () => {
    store().apply(SESSION, [span("r1", "run")]);
    store().forgetSession(SESSION);
    expect(store().bySession[SESSION]).toBeUndefined();
  });
});
