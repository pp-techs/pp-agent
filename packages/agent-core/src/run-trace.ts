/**
 * The run trace of one conversation (the Run tab): a span per turn, per agent working in it (the
 * conversation's own agent and each helper of `delegate_task`) and per tool call. Changed spans
 * are gathered and sent together every `RUN_TRACE_LIMITS.flushMs`, so a busy run costs one event
 * per tick instead of one per change.
 */
import {
  RUN_TRACE_LIMITS,
  type RunSpan,
  type RunSpanStatus,
  runSpanEnded,
} from "@workspace/shared";

/** Keys whose values are left out of a call's arguments: they may carry secrets. */
const SECRET_KEY = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential/i;

/** `text` as one line, cut to `max` characters. */
export function oneLine(text: string, max: number = RUN_TRACE_LIMITS.line): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** A call's arguments as JSON for the trace, with secret-looking values hidden and long text cut. */
export function previewArgs(args: unknown): string | undefined {
  if (args === undefined || args === null) return undefined;
  try {
    const json = JSON.stringify(
      args,
      (key, value: unknown) => {
        if (key && SECRET_KEY.test(key)) return "•••";
        // Base64 images and other blobs say nothing in a preview.
        if (typeof value === "string" && value.length > RUN_TRACE_LIMITS.args)
          return `${value.slice(0, 200)}… (${value.length} chars)`;
        return value;
      },
      2,
    );
    return json === "{}" ? undefined : cut(json, RUN_TRACE_LIMITS.args);
  } catch {
    return undefined;
  }
}

/** The text of a tool result (`content` blocks), cut for the trace; images are named, not sent. */
export function previewOutput(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts = content.map((block: unknown) => {
    if (typeof block !== "object" || block === null) return "";
    const { type, text } = block as { type?: unknown; text?: unknown };
    if (type === "text" && typeof text === "string") return text;
    if (type === "image") return "[image]";
    return "";
  });
  const text = parts.filter(Boolean).join("\n").trim();
  return text ? cut(text, RUN_TRACE_LIMITS.output) : undefined;
}

/** What a tool call works on, in one short line. */
export function traceTarget(args: unknown): string | undefined {
  const input = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
  const value = ["path", "pattern", "query", "url", "command", "name", "action"]
    .map((key) => input[key])
    .find((candidate): candidate is string => typeof candidate === "string" && candidate !== "");
  return value ? oneLine(value) : undefined;
}

/** What the trace needs of a model reply. */
export interface StepMessage {
  content?: unknown;
  stopReason?: string;
  errorMessage?: string;
  usage?: { input?: number; output?: number };
}

/** A model step's end: its status, what it said (else what it thought), and its tokens. */
export function stepEnd(message: StepMessage): Partial<RunSpan> {
  const blocks = Array.isArray(message.content) ? (message.content as unknown[]) : [];
  const texts = (type: string, key: string) =>
    blocks
      .map((block) => {
        if (typeof block !== "object" || block === null) return "";
        const record = block as Record<string, unknown>;
        return record.type === type && typeof record[key] === "string" ? record[key] : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  const text = texts("text", "text");
  const thinking = texts("thinking", "thinking");
  const status: RunSpanStatus =
    message.stopReason === "aborted"
      ? "stopped"
      : message.stopReason === "error"
        ? "error"
        : "done";
  const input = message.usage?.input ?? 0;
  const output = message.usage?.output ?? 0;
  return {
    status,
    ...(text ? { output: cut(text, RUN_TRACE_LIMITS.output) } : {}),
    // The thinking goes where a tool's arguments go: what led to the calls that follow.
    ...(thinking ? { args: cut(thinking, RUN_TRACE_LIMITS.args) } : {}),
    ...(text || thinking ? { target: oneLine(text || thinking) } : {}),
    ...(message.errorMessage ? { error: oneLine(message.errorMessage) } : {}),
    ...(input || output ? { usage: { input, output } } : {}),
  };
}

/** Where spans go: the tracer of a conversation, or a part of it (a helper's spans). */
export interface SpanSink {
  /** Adds a span, or merges `span` into the one with its id. */
  upsert(span: Pick<RunSpan, "id"> & Partial<RunSpan>): void;
  /** A span id unique in this conversation. */
  nextId(prefix: string): string;
}

/** One conversation's trace: its runs, newest last, with their spans. */
export class RunTracer implements SpanSink {
  private readonly spans = new Map<string, RunSpan>();
  /** Run ids, oldest first, and the spans each holds. */
  private readonly runs: { id: string; spans: Set<string> }[] = [];
  private readonly changed = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private counter = 0;
  /** The run going on, its agent span, and the model step whose tool calls run now. */
  private current: { run: string; agent: string; step?: string } | null = null;
  /** How the run going on ended, as its last reply said; `done` unless it failed or was stopped. */
  private outcome: RunSpanStatus = "done";

  constructor(
    /** Sends changed spans. */
    private readonly send: (spans: RunSpan[]) => void,
    private readonly now: () => number = Date.now,
  ) {}

  nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}${this.counter.toString(36)}`;
  }

  /** The agent span of the run going on; tool calls hang under it. */
  get agentSpan(): string | undefined {
    return this.current?.agent;
  }

  /** A turn starts: a run span and the conversation agent's span under it. */
  startRun(name: string, agent: { name: string; model?: string }): void {
    if (this.current) this.endRun("done");
    const run = this.nextId("r");
    const at = this.now();
    this.runs.push({ id: run, spans: new Set() });
    this.current = { run, agent: `${run}/a` };
    this.outcome = "done";
    this.upsert({
      id: run,
      kind: "run",
      name: oneLine(name) || "Run",
      status: "running",
      startedAt: at,
    });
    this.upsert({
      id: this.current.agent,
      parentId: run,
      kind: "agent",
      name: agent.name,
      ...(agent.model ? { model: agent.model } : {}),
      status: "running",
      startedAt: at,
    });
    while (this.runs.length > RUN_TRACE_LIMITS.runs) {
      const old = this.runs.shift();
      for (const id of old?.spans ?? []) this.spans.delete(id);
    }
  }

  /** Names the run going on after the person's message, once it is known. */
  nameRun(text: string): void {
    const name = oneLine(text);
    if (this.current && name) this.upsert({ id: this.current.run, name });
  }

  /** The last reply of the run going on failed or was stopped (or went on fine again). */
  noteOutcome(status: RunSpanStatus): void {
    if (this.current) this.outcome = status;
  }

  /**
   * The turn settled: its run and agent end with `status`, and every span still open in it ends as
   * stopped (a call cut short by Stop, a helper that never reported back).
   */
  endRun(status: RunSpanStatus = this.outcome): void {
    const current = this.current;
    if (!current) return;
    this.current = null;
    const at = this.now();
    const run = this.runs.find((item) => item.id === current.run);
    for (const id of run?.spans ?? []) {
      const span = this.spans.get(id);
      if (!span || runSpanEnded(span.status)) continue;
      const own = id === current.run || id === current.agent;
      this.upsert({ id, status: own ? status : "stopped", endedAt: at });
    }
    this.flush();
  }

  /** The model starts a reply: a step after the tool calls of the one before. */
  startStep(): void {
    if (!this.current) return;
    const id = `${this.current.agent}/${this.nextId("s")}`;
    this.current.step = id;
    this.upsert({
      id,
      parentId: this.current.agent,
      kind: "step",
      name: "model",
      status: "running",
      startedAt: this.now(),
    });
  }

  /** The model's reply is complete; the tool calls it asked for hang under its step. */
  endStep(message: StepMessage): void {
    const id = this.current?.step;
    const span = id ? this.spans.get(id) : undefined;
    if (!id || !span || runSpanEnded(span.status)) return;
    this.upsert({ id, ...stepEnd(message), endedAt: this.now() });
  }

  /** A tool call of the conversation's agent starts. */
  startTool(toolCallId: string, toolName: string, args: unknown): void {
    if (!this.current) return;
    const target = traceTarget(args);
    const preview = previewArgs(args);
    this.upsert({
      id: toolCallId,
      parentId: this.current.step ?? this.current.agent,
      kind: "tool",
      name: toolName,
      status: "running",
      startedAt: this.now(),
      ...(target ? { target } : {}),
      ...(preview ? { args: preview } : {}),
    });
  }

  /** A tool call waits for the person (approval or answer), or goes on after they replied. */
  setToolStatus(toolCallId: string, status: RunSpanStatus): void {
    const span = this.spans.get(toolCallId);
    if (!span || runSpanEnded(span.status)) return;
    this.upsert({
      id: toolCallId,
      status,
      ...(runSpanEnded(status) ? { endedAt: this.now() } : {}),
    });
  }

  /** A tool call of the conversation's agent ended. */
  endTool(toolCallId: string, content: unknown, isError: boolean): void {
    const span = this.spans.get(toolCallId);
    if (!span) return;
    const output = previewOutput(content);
    // A denied call ends with an error result; it stays denied.
    const status = span.status === "denied" ? "denied" : isError ? "error" : "done";
    this.upsert({
      id: toolCallId,
      status,
      endedAt: this.now(),
      ...(output ? { output } : {}),
      ...(isError && output ? { error: oneLine(output) } : {}),
    });
  }

  upsert(change: Pick<RunSpan, "id"> & Partial<RunSpan>): void {
    const before = this.spans.get(change.id);
    if (!before) {
      const run = this.runs.at(-1);
      // Past the cap, or no run to hold it: not traced.
      if (!run || run.spans.size >= RUN_TRACE_LIMITS.spansPerRun) return;
      if (!change.kind || !change.name || !change.status || change.startedAt === undefined) return;
      run.spans.add(change.id);
      this.spans.set(change.id, change as RunSpan);
    } else {
      this.spans.set(change.id, { ...before, ...change });
    }
    this.changed.add(change.id);
    this.timer ??= setTimeout(() => this.flush(), RUN_TRACE_LIMITS.flushMs);
  }

  /** Sends the spans changed since the last time, now. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.changed.size === 0) return;
    const spans = [...this.changed]
      .map((id) => this.spans.get(id))
      .filter((span): span is RunSpan => span !== undefined);
    this.changed.clear();
    if (spans.length > 0) this.send(spans);
  }

  /** The latest run's spans while it is running, for a listener catching up. */
  live(): RunSpan[] | undefined {
    if (!this.current) return undefined;
    const run = this.runs.at(-1);
    if (!run) return undefined;
    return [...run.spans]
      .map((id) => this.spans.get(id))
      .filter((span): span is RunSpan => span !== undefined);
  }

  /** Stops sending; spans waiting to go out are dropped. */
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.changed.clear();
  }
}

/**
 * The spans of one `delegate_task` call: a span per helper under the call's span, and one per tool
 * call the helper makes.
 */
export class HelperTrace {
  private readonly agent: string;

  constructor(
    private readonly sink: SpanSink,
    parentId: string,
    index: number,
    helper: { label: string; model?: string; task: string },
    private readonly now: () => number = Date.now,
  ) {
    this.agent = `${parentId}/h${index}`;
    sink.upsert({
      id: this.agent,
      parentId,
      kind: "agent",
      name: helper.label,
      status: "running",
      startedAt: now(),
      target: oneLine(helper.task),
      args: helper.task.slice(0, RUN_TRACE_LIMITS.args),
      ...(helper.model ? { model: helper.model } : {}),
    });
  }

  private readonly calls = new Map<string, string>();
  /** The helper's model step going on, or the last one (its tool calls hang under it). */
  private step: { id: string; open: boolean } | null = null;

  startStep(): void {
    const id = `${this.agent}/${this.sink.nextId("s")}`;
    this.step = { id, open: true };
    this.sink.upsert({
      id,
      parentId: this.agent,
      kind: "step",
      name: "model",
      status: "running",
      startedAt: this.now(),
    });
  }

  endStep(message: StepMessage): void {
    if (!this.step?.open) return;
    this.step.open = false;
    this.sink.upsert({ id: this.step.id, ...stepEnd(message), endedAt: this.now() });
  }

  startTool(toolCallId: string, toolName: string, args: unknown): void {
    const id = `${this.agent}/${this.sink.nextId("t")}`;
    this.calls.set(toolCallId, id);
    const target = traceTarget(args);
    const preview = previewArgs(args);
    this.sink.upsert({
      id,
      parentId: this.step?.id ?? this.agent,
      kind: "tool",
      name: toolName,
      status: "running",
      startedAt: this.now(),
      ...(target ? { target } : {}),
      ...(preview ? { args: preview } : {}),
    });
  }

  endTool(toolCallId: string, content: unknown, isError: boolean): void {
    const id = this.calls.get(toolCallId);
    if (!id) return;
    this.calls.delete(toolCallId);
    const output = previewOutput(content);
    this.sink.upsert({
      id,
      status: isError ? "error" : "done",
      endedAt: this.now(),
      ...(output ? { output } : {}),
      ...(isError && output ? { error: oneLine(output) } : {}),
    });
  }

  /** The helper finished (`output` is its summary) or failed (`error`). */
  end(result: { output?: string } | { error: string }): void {
    const at = this.now();
    // Calls cut short by the helper's limits never report their end.
    for (const id of this.calls.values()) this.sink.upsert({ id, status: "stopped", endedAt: at });
    this.calls.clear();
    if (this.step?.open) {
      this.step.open = false;
      this.sink.upsert({ id: this.step.id, status: "stopped", endedAt: at });
    }
    if ("error" in result) {
      this.sink.upsert({
        id: this.agent,
        status: result.error === "Stopped." ? "stopped" : "error",
        endedAt: at,
        error: oneLine(result.error),
      });
    } else {
      this.sink.upsert({
        id: this.agent,
        status: "done",
        endedAt: at,
        ...(result.output ? { output: result.output.slice(0, RUN_TRACE_LIMITS.output) } : {}),
      });
    }
  }
}
