import { RUN_TRACE_LIMITS, type RunSpan } from "@workspace/shared";
import { create } from "zustand";

/** The run trace of one conversation, as this window has seen it. */
export interface RunTrace {
  /** Run span ids, oldest first. */
  runs: string[];
  /** Every span by id. */
  spans: Record<string, RunSpan>;
}

const EMPTY: RunTrace = { runs: [], spans: {} };

interface RunState {
  /** By session file (`""` for a conversation without one). */
  bySession: Record<string, RunTrace>;
  /** Merges changed spans into a conversation's trace. */
  apply: (session: string, spans: RunSpan[]) => void;
  /** The conversation is gone: so is its trace. */
  forgetSession: (session: string) => void;
}

/** The run each span belongs to, walking up its parents. */
function runOf(spans: Record<string, RunSpan>, span: RunSpan): string | undefined {
  let current: RunSpan | undefined = span;
  for (let depth = 0; current && depth < 16; depth++) {
    if (current.kind === "run") return current.id;
    current = current.parentId ? spans[current.parentId] : undefined;
  }
  return undefined;
}

/** `trace` with `changes` merged in; the oldest runs go past `RUN_TRACE_LIMITS.runs`. */
export function mergeSpans(trace: RunTrace, changes: RunSpan[]): RunTrace {
  if (changes.length === 0) return trace;
  const spans = { ...trace.spans };
  let runs = trace.runs;
  for (const change of changes) {
    spans[change.id] = { ...spans[change.id], ...change };
    if (change.kind === "run" && !runs.includes(change.id)) runs = [...runs, change.id];
  }
  if (runs.length > RUN_TRACE_LIMITS.runs) {
    const dropped = new Set(runs.slice(0, runs.length - RUN_TRACE_LIMITS.runs));
    runs = runs.slice(-RUN_TRACE_LIMITS.runs);
    for (const span of Object.values(spans)) {
      const run = runOf(spans, span);
      if (run === undefined || dropped.has(run)) delete spans[span.id];
    }
  }
  return { runs, spans };
}

export const useRunStore = create<RunState>()((set) => ({
  bySession: {},
  apply: (session, changes) =>
    set((state) => ({
      bySession: {
        ...state.bySession,
        [session]: mergeSpans(state.bySession[session] ?? EMPTY, changes),
      },
    })),
  forgetSession: (session) =>
    set((state) => {
      if (!(session in state.bySession)) return state;
      const { [session]: _gone, ...rest } = state.bySession;
      return { bySession: rest };
    }),
}));

/** The spans of one run, its own span first. */
export function spansOfRun(trace: RunTrace, runId: string): RunSpan[] {
  return Object.values(trace.spans)
    .filter((span) => runOf(trace.spans, span) === runId)
    .sort((a, b) => a.startedAt - b.startedAt || (a.kind === "run" ? -1 : 0));
}

/** Whether a conversation has a run going on. */
export function hasLiveRun(trace: RunTrace | undefined): boolean {
  const last = trace?.runs.at(-1);
  if (!trace || !last) return false;
  const span = trace.spans[last];
  return span?.status === "running" || span?.status === "waiting";
}
