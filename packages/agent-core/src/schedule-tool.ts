/**
 * `schedule_manage`: one tool for the agent to create, list, edit, pause, resume, run and remove
 * scheduled tasks — the same tasks Settings › Scheduled tasks lists. Creating asks first (write
 * tier). Not offered inside a scheduled run, so a task cannot spawn tasks.
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { SCHEDULE_LIMITS, type SaveScheduledTaskInput, type TaskSchedule } from "@workspace/shared";
import { Type } from "typebox";

export const SCHEDULE_TOOL = "schedule_manage";

export interface CreatedTask {
  name: string;
  /** Next run, epoch milliseconds. */
  nextRun: number | null;
}

export interface TaskListEntry {
  name: string;
  schedule: string;
  enabled: boolean;
  nextRun: number | null;
  lastStatus?: string;
}

/** Everything the tool needs from the host. */
export interface ScheduleHost {
  currentSessionId(): string | null;
  create(input: SaveScheduledTaskInput): CreatedTask;
  list(): TaskListEntry[];
  update(name: string, patch: Partial<SaveScheduledTaskInput>): void;
  pause(name: string): void;
  resume(name: string): void;
  runNow(name: string): void;
  remove(name: string): void;
}

const SCHEDULE_SCHEMA = Type.Union([
  Type.Object({
    kind: Type.Literal("once"),
    at: Type.Number({ description: "epoch milliseconds" }),
  }),
  Type.Object({
    kind: Type.Literal("interval"),
    every: Type.Integer({ minimum: 1, maximum: SCHEDULE_LIMITS.maxMinutes }),
    unit: Type.Union([Type.Literal("minutes"), Type.Literal("hours")]),
  }),
  Type.Object({ kind: Type.Literal("daily"), time: Type.String() }),
  Type.Object({
    kind: Type.Literal("weekly"),
    days: Type.Array(Type.Integer({ minimum: 0, maximum: 6 })),
    time: Type.String(),
  }),
]);

export function createScheduleTool(host: ScheduleHost) {
  return defineTool({
    name: SCHEDULE_TOOL,
    label: "Scheduled tasks",
    description:
      "Creates and manages scheduled tasks: prompts that run by themselves on a schedule. " +
      "Actions: `create`, `list`, `update`, `pause`, `resume`, `run`, `remove`. " +
      'Use `once` for a reminder ("in 30 minutes", "at 21:00 today"); `interval`, `daily` or ' +
      "`weekly` for recurring work. " +
      "`target` decides where the run happens: `current` (reads the tail of this conversation and " +
      "writes its result here — best for reminders), `new` (fresh conversation every run), or " +
      "`session:<id>` (one named session reused across runs — best for recurring reports). " +
      "`deliver` decides where the result goes: `session` (default, stays in the run's " +
      "conversation), `home` (sends to the user's own chat), `peer:<key>` (sends to a specific " +
      "chat from the peers list), or `none`. " +
      "Write the prompt so it stands alone when target is `new`.",
    promptSnippet: "Create or manage a task that runs on a schedule",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("create"),
        Type.Literal("list"),
        Type.Literal("update"),
        Type.Literal("pause"),
        Type.Literal("resume"),
        Type.Literal("run"),
        Type.Literal("remove"),
      ]),
      name: Type.Optional(
        Type.String({
          description: "Task name (required for create/update/pause/resume/run/remove)",
        }),
      ),
      prompt: Type.Optional(Type.String({ description: "What the agent should do at every run" })),
      when: Type.Optional(SCHEDULE_SCHEMA),
      target: Type.Optional(
        Type.String({
          description:
            'Where the run happens: "current" (this conversation), "new" (fresh each time), or "session:<id>"',
        }),
      ),
      deliver: Type.Optional(
        Type.String({
          description:
            'Where the result goes: "session" (default), "home" (user\'s own chat), "peer:<key>", or "none"',
        }),
      ),
      deleteAfterRun: Type.Optional(Type.Boolean()),
      silentIfEmpty: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params) {
      const text = (value: string) => ({
        content: [{ type: "text" as const, text: value }],
        details: undefined,
      });
      const { action } = params;

      if (action === "list") {
        const tasks = host.list();
        if (tasks.length === 0) return text("No scheduled tasks.");
        return text(
          tasks
            .map((t) => {
              const next = t.nextRun ? new Date(t.nextRun).toISOString() : "none";
              return `- ${t.name}  [${t.enabled ? "on" : "off"}]  ${t.schedule}  next: ${next}${t.lastStatus ? `  last: ${t.lastStatus}` : ""}`;
            })
            .join("\n"),
        );
      }

      const name = params.name?.trim();
      if (!name) throw new Error("`name` is required.");

      if (action === "pause") {
        host.pause(name);
        return text(`Paused "${name}".`);
      }
      if (action === "resume") {
        host.resume(name);
        return text(`Resumed "${name}".`);
      }
      if (action === "run") {
        host.runNow(name);
        return text(`Running "${name}" now.`);
      }
      if (action === "remove") {
        host.remove(name);
        return text(`Removed "${name}".`);
      }

      if (action === "update") {
        const patch: Partial<SaveScheduledTaskInput> = {};
        if (params.prompt) patch.prompt = params.prompt;
        if (params.when) patch.schedule = params.when as TaskSchedule;
        if (params.target !== undefined) patch.target = parseTarget(params.target, host);
        if (params.deliver !== undefined) patch.delivery = parseDelivery(params.deliver);
        if (params.deleteAfterRun !== undefined) patch.deleteAfterRun = params.deleteAfterRun;
        if (params.silentIfEmpty !== undefined) patch.silentIfEmpty = params.silentIfEmpty;
        host.update(name, patch);
        return text(`Updated "${name}".`);
      }

      // create
      if (!params.prompt) throw new Error("`prompt` is required to create a task.");
      if (!params.when) throw new Error("`when` is required to create a task.");
      const input: SaveScheduledTaskInput = {
        name,
        prompt: params.prompt,
        schedule: params.when as TaskSchedule,
        enabled: true,
        agentId: "",
        workspaceId: "",
        ...(params.target !== undefined ? { target: parseTarget(params.target, host) } : {}),
        ...(params.deliver !== undefined ? { delivery: parseDelivery(params.deliver) } : {}),
        ...(params.deleteAfterRun ? { deleteAfterRun: true } : {}),
        ...(params.silentIfEmpty ? { silentIfEmpty: true } : {}),
      };
      const task = host.create(input);
      const next = task.nextRun === null ? "none" : new Date(task.nextRun).toISOString();
      return text(`Created "${task.name}". Next run: ${next}.`);
    },
  });
}

/** `"current"` / `"new"` / `"session:<id>"` → ScheduleTarget. */
function parseTarget(value: string, host: ScheduleHost): SaveScheduledTaskInput["target"] {
  if (value === "current") {
    const sessionId = host.currentSessionId()?.trim();
    if (!sessionId) throw new Error('`target: "current"` requires a saved conversation.');
    return { mode: "current", sessionId };
  }
  if (value === "new") return { mode: "new" };
  if (value.startsWith("session:")) {
    const sessionId = value.slice(8).trim();
    if (sessionId) return { mode: "session", sessionId };
  }
  throw new Error('`target` must be "current", "new", or "session:<id>" with a nonempty ID.');
}

/** `"session"` / `"home"` / `"peer:<key>"` / `"none"` → ScheduleDelivery. */
function parseDelivery(value: string): SaveScheduledTaskInput["delivery"] {
  if (value === "session") return { to: "session" };
  if (value === "none") return { to: "none" };
  if (value === "home") return { to: "peer", peer: "home" };
  if (value.startsWith("peer:") && value.slice(5).trim())
    return { to: "peer", peer: value.slice(5) };
  throw new Error(
    '`deliver` must be "session", "none", "home", or "peer:<key>" with a nonempty key.',
  );
}
