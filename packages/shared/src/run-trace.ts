/**
 * Trace of an agent run, for the Run tab: the conversation's turns, the agents working in them
 * (the conversation's own agent and the helpers of `delegate_task`), and every tool call, with
 * when it started and ended. Sent as `run_trace` events of changed spans; a listener upserts them
 * by id.
 */

/** `step` is one reply of the model: what it said or thought, before the tool calls it asked for. */
export type RunSpanKind = "run" | "agent" | "step" | "tool";

export type RunSpanStatus = "running" | "waiting" | "done" | "error" | "denied" | "stopped";

export interface RunSpan {
  /** Unique within the conversation. */
  id: string;
  /** The span this one runs under: run → agent → tool → (helper) agent → tool. */
  parentId?: string;
  kind: RunSpanKind;
  /** Tool name, helper label, or agent name; for a run, the start of the prompt. */
  name: string;
  status: RunSpanStatus;
  /** Epoch milliseconds, as the agent host saw it. */
  startedAt: number;
  endedAt?: number;
  /** What a tool call works on, in one short line (a path, a query, an address). */
  target?: string;
  /** The call's arguments as JSON, cut to `RUN_TRACE_LIMITS.args`. */
  args?: string;
  /** What the call returned, cut to `RUN_TRACE_LIMITS.output`. */
  output?: string;
  /** Model an agent span runs on (`provider/id`). */
  model?: string;
  /** Why it failed or stopped early. */
  error?: string;
  /** Tokens a model step read and wrote. */
  usage?: { input: number; output: number };
}

export const RUN_TRACE_LIMITS = {
  /** Characters of a call's arguments kept. */
  args: 2000,
  /** Characters of a call's result kept. */
  output: 4000,
  /** Characters of a target or an error kept. */
  line: 160,
  /** Runs a conversation keeps (host and listener alike); older ones are dropped. */
  runs: 20,
  /** Spans one run keeps; later tool calls are not traced. */
  spansPerRun: 2000,
  /** How long changes are gathered before they are sent together. */
  flushMs: 100,
} as const;

/** A finished status, after which a span does not change again. */
export function runSpanEnded(status: RunSpanStatus): boolean {
  return status !== "running" && status !== "waiting";
}
