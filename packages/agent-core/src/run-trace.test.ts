import type { RunSpan } from "@workspace/shared";
import { RUN_TRACE_LIMITS } from "@workspace/shared";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { HelperTrace, previewArgs, previewOutput, RunTracer, traceTarget } from "./run-trace.ts";

let sent: RunSpan[][];
let clock: number;
const tracer = () =>
  new RunTracer(
    (spans) => sent.push(spans),
    () => clock,
  );
/** Every span as last sent, by id. */
const latest = () => {
  const spans = new Map<string, RunSpan>();
  for (const batch of sent) for (const span of batch) spans.set(span.id, span);
  return spans;
};

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  clock = 1000;
});
afterEach(() => vi.useRealTimers());

describe("RunTracer", () => {
  test("a run holds the agent span and the tool calls under it, sent together per tick", () => {
    const trace = tracer();
    trace.startRun("", { name: "Assistant", model: "p/m" });
    trace.nameRun("Find   the\nreport");
    trace.startTool("call-1", "read", { path: "a.md" });
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(RUN_TRACE_LIMITS.flushMs);
    expect(sent).toHaveLength(1);

    clock = 1500;
    trace.endTool("call-1", [{ type: "text", text: "contents" }], false);
    trace.endRun();
    const spans = latest();
    const run = [...spans.values()].find((span) => span.kind === "run");
    const agent = [...spans.values()].find((span) => span.kind === "agent");
    expect(run).toMatchObject({ name: "Find the report", status: "done", endedAt: 1500 });
    expect(agent).toMatchObject({ parentId: run?.id, name: "Assistant", model: "p/m" });
    expect(spans.get("call-1")).toMatchObject({
      parentId: agent?.id,
      kind: "tool",
      name: "read",
      target: "a.md",
      status: "done",
      startedAt: 1000,
      endedAt: 1500,
      output: "contents",
    });
  });

  test("a call waiting for the person, then denied, stays denied after its error result", () => {
    const trace = tracer();
    trace.startRun("Go", { name: "A" });
    trace.startTool("c", "bash", { command: "rm -rf x" });
    trace.setToolStatus("c", "waiting");
    expect(trace.live()?.find((span) => span.id === "c")?.status).toBe("waiting");
    trace.setToolStatus("c", "denied");
    trace.endTool("c", [{ type: "text", text: "Denied" }], true);
    trace.flush();
    expect(latest().get("c")?.status).toBe("denied");
  });

  test("stopping a run ends what is still open as stopped", () => {
    const trace = tracer();
    trace.startRun("Go", { name: "A" });
    trace.startTool("c", "read", {});
    trace.noteOutcome("stopped");
    trace.endRun();
    const spans = [...latest().values()];
    expect(spans.every((span) => span.status === "stopped" && span.endedAt === 1000)).toBe(true);
    expect(trace.live()).toBeUndefined();
  });

  test("keeps the newest runs only", () => {
    const trace = tracer();
    for (let n = 0; n < RUN_TRACE_LIMITS.runs + 2; n++) {
      trace.startRun(`run ${n}`, { name: "A" });
      trace.endRun();
    }
    trace.startRun("last", { name: "A" });
    expect(trace.live()?.[0]?.name).toBe("last");
  });

  test("tool calls outside a run are not traced", () => {
    const trace = tracer();
    trace.startTool("c", "read", {});
    trace.flush();
    expect(sent).toHaveLength(0);
  });
});

describe("model steps", () => {
  test("each reply is a step; the calls it asked for hang under it", () => {
    const trace = tracer();
    trace.startRun("Go", { name: "A" });
    trace.startStep();
    trace.endStep({
      content: [
        { type: "thinking", thinking: "Need the file" },
        { type: "text", text: "Reading it." },
      ],
      stopReason: "toolUse",
      usage: { input: 100, output: 20 },
    });
    trace.startTool("c1", "read", { path: "a.md" });
    trace.endTool("c1", [], false);
    trace.startStep();
    trace.endStep({ content: [], stopReason: "error", errorMessage: "Rate limited" });
    trace.endRun();

    const spans = [...latest().values()];
    const steps = spans.filter((span) => span.kind === "step");
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({
      status: "done",
      output: "Reading it.",
      args: "Need the file",
      target: "Reading it.",
      usage: { input: 100, output: 20 },
    });
    expect(steps[1]).toMatchObject({ status: "error", error: "Rate limited" });
    expect(latest().get("c1")?.parentId).toBe(steps[0]?.id);
  });
});

describe("HelperTrace", () => {
  test("adds a helper under the delegate call, with its own tool calls", () => {
    const trace = tracer();
    trace.startRun("Go", { name: "A" });
    trace.startTool("del", "delegate_task", { tasks: [] });
    const helper = new HelperTrace(
      trace,
      "del",
      0,
      { label: "Docs", task: "Read docs", model: "p/m" },
      () => clock,
    );
    helper.startTool("h-call", "grep", { pattern: "todo" });
    clock = 2000;
    helper.endTool("h-call", [{ type: "text", text: "3 hits" }], false);
    helper.startTool("h-call-2", "read", { path: "b.md" });
    helper.end({ output: "Summary" });
    trace.flush();

    const spans = [...latest().values()];
    const agent = spans.find((span) => span.id === "del/h0");
    expect(agent).toMatchObject({
      parentId: "del",
      kind: "agent",
      name: "Docs",
      status: "done",
      output: "Summary",
    });
    const tools = spans.filter((span) => span.parentId === "del/h0");
    expect(tools.map((span) => [span.name, span.status, span.target])).toEqual([
      ["grep", "done", "todo"],
      ["read", "stopped", "b.md"],
    ]);
  });

  test("a helper stopped by the person is stopped, one that failed is an error", () => {
    const trace = tracer();
    trace.startRun("Go", { name: "A" });
    new HelperTrace(trace, "d", 0, { label: "One", task: "x" }).end({ error: "Stopped." });
    new HelperTrace(trace, "d", 1, { label: "Two", task: "x" }).end({ error: "Model failed" });
    trace.flush();
    expect(latest().get("d/h0")?.status).toBe("stopped");
    expect(latest().get("d/h1")).toMatchObject({ status: "error", error: "Model failed" });
  });
});

describe("previews", () => {
  test("hide secret-looking values and cut long text", () => {
    const args = previewArgs({
      url: "https://x",
      apiKey: "sk-1",
      headers: { Authorization: "Bearer t" },
    });
    expect(args).toContain("https://x");
    expect(args).not.toContain("sk-1");
    expect(args).not.toContain("Bearer t");
    expect(previewArgs({ content: "x".repeat(10_000) })?.length).toBeLessThanOrEqual(
      RUN_TRACE_LIMITS.args,
    );
    expect(previewArgs({})).toBeUndefined();
  });

  test("take the text of a result and name its images", () => {
    expect(
      previewOutput([
        { type: "text", text: "a" },
        { type: "image", data: "…" },
      ]),
    ).toBe("a\n[image]");
    expect(previewOutput("nope")).toBeUndefined();
    expect(previewOutput([{ type: "text", text: "x".repeat(10_000) }])?.length).toBe(
      RUN_TRACE_LIMITS.output,
    );
  });

  test("a call's target is the first useful argument, on one line", () => {
    expect(traceTarget({ query: "a\n b" })).toBe("a b");
    expect(traceTarget({ other: 1 })).toBeUndefined();
  });
});
