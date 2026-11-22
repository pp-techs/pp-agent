import type { RunSpan, RunSpanStatus } from "@workspace/shared";

/** Status colours: the theme's primary for work going on, fixed hues elsewhere (both themes). */
export const STATUS_COLOR: Record<RunSpanStatus, string> = {
  running: "#3b82f6",
  waiting: "#f59e0b",
  done: "#10b981",
  error: "#ef4444",
  denied: "#a855f7",
  stopped: "#94a3b8",
};

/** Tailwind classes of the same colours, for HTML. */
export const STATUS_DOT: Record<RunSpanStatus, string> = {
  running: "bg-blue-500",
  waiting: "bg-amber-500",
  done: "bg-emerald-500",
  error: "bg-red-500",
  denied: "bg-purple-500",
  stopped: "bg-slate-400",
};

export function isLive(span: RunSpan): boolean {
  return span.status === "running" || span.status === "waiting";
}

/** `ms` as `850 ms`, `12.4 s` or `3 m 05 s`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes} m ${seconds.toString().padStart(2, "0")} s`;
}

export function spanDuration(span: RunSpan, now: number): number {
  return (span.endedAt ?? now) - span.startedAt;
}

/** A lane of the timeline: an agent, its model steps and the tool calls it made. */
export interface Lane {
  agent: RunSpan;
  depth: number;
  /** The agent's model steps, shown on its own row. */
  steps: RunSpan[];
  tools: RunSpan[];
}

/**
 * The run's agents in tree order (the conversation's agent, then each helper right after the call
 * that started it), each with its own tool calls.
 */
export function lanesOf(spans: RunSpan[]): Lane[] {
  const children = new Map<string, RunSpan[]>();
  for (const span of spans) {
    if (!span.parentId) continue;
    const list = children.get(span.parentId) ?? [];
    list.push(span);
    children.set(span.parentId, list);
  }
  const lanes: Lane[] = [];
  const visit = (agent: RunSpan, depth: number) => {
    // Model steps and the calls each asked for (calls hang under their step).
    const own = children.get(agent.id) ?? [];
    const steps = own.filter((span) => span.kind === "step");
    const tools = own.filter((span) => span.kind === "tool");
    for (const step of steps)
      tools.push(...(children.get(step.id) ?? []).filter((span) => span.kind === "tool"));
    tools.sort((a, b) => a.startedAt - b.startedAt);
    lanes.push({ agent, depth, steps, tools });
    for (const tool of tools) {
      for (const helper of children.get(tool.id) ?? []) {
        if (helper.kind === "agent") visit(helper, depth + 1);
      }
    }
  };
  const run = spans.find((span) => span.kind === "run");
  for (const agent of (run ? children.get(run.id) : undefined) ?? []) {
    if (agent.kind === "agent") visit(agent, 0);
  }
  return lanes;
}
