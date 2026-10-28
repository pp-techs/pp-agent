/**
 * Scheduled tasks as stored in settings.json: reading them back leniently, checking what a person
 * typed strictly, and the names a run gets.
 */
import {
  DEFAULT_AGENT_ID,
  DEFAULT_WORKSPACE_ID,
  SCHEDULE_LIMITS,
  type SaveScheduledTaskInput,
  type ScheduleDelivery,
  type ScheduleTarget,
  type ScheduledTask,
  type TaskRun,
} from "@workspace/shared";
import { t } from "./i18n.ts";
import { parseSchedule, type ScheduleProblem } from "./scheduler.ts";

const ID_PREFIX = "task-";

type Loose = Partial<Record<keyof ScheduledTask, unknown>>;

function asLoose(value: unknown): Loose | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Loose)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readRun(raw: unknown): TaskRun | null {
  const value = asLoose(raw) as Partial<Record<keyof TaskRun, unknown>> | null;
  if (!value) return null;
  const { at, durationMs, status, deniedTools, error, sessionPath } = value;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  if (status !== "completed" && status !== "failed") return null;
  return {
    at,
    durationMs: typeof durationMs === "number" && durationMs >= 0 ? durationMs : 0,
    status,
    deniedTools:
      typeof deniedTools === "number" && Number.isInteger(deniedTools) && deniedTools > 0
        ? deniedTools
        : 0,
    ...(typeof error === "string" && error ? { error: error.slice(0, 2_000) } : {}),
    ...(typeof sessionPath === "string" && sessionPath ? { sessionPath } : {}),
  };
}

/**
 * Tasks read from settings.json. Entries that do not fit are dropped one by one; duplicate ids and
 * names (case-insensitively) keep the first; at most `SCHEDULE_LIMITS.maxTasks` are kept.
 */
export function readScheduledTasks(raw: unknown): ScheduledTask[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  const names = new Set<string>();
  const tasks: ScheduledTask[] = [];
  for (const entry of raw) {
    const value = asLoose(entry);
    if (!value) continue;
    const id = text(value.id);
    const name = text(value.name);
    const prompt = text(value.prompt);
    const schedule = parseSchedule(value.schedule);
    if (!id || !name || !prompt || !schedule.ok) continue;
    if (name.length > SCHEDULE_LIMITS.maxNameLength) continue;
    if (prompt.length > SCHEDULE_LIMITS.maxPromptLength) continue;
    if (ids.has(id) || names.has(name.toLowerCase())) continue;
    ids.add(id);
    names.add(name.toLowerCase());
    const armedAt = value.armedAt;
    tasks.push({
      id,
      name,
      prompt,
      agentId: text(value.agentId) || DEFAULT_AGENT_ID,
      workspaceId: text(value.workspaceId) || DEFAULT_WORKSPACE_ID,
      schedule: schedule.schedule,
      enabled: value.enabled === true,
      armedAt: typeof armedAt === "number" && Number.isFinite(armedAt) ? armedAt : Date.now(),
      lastRun: readRun(value.lastRun),
      ...readTarget(value.target),
      ...readDelivery(value.delivery),
      ...(typeof value.origin === "string" && value.origin ? { origin: value.origin } : {}),
      ...(value.deleteAfterRun === true ? { deleteAfterRun: true } : {}),
      ...(value.silentIfEmpty === true ? { silentIfEmpty: true } : {}),
    });
    if (tasks.length >= SCHEDULE_LIMITS.maxTasks) break;
  }
  return tasks;
}

function readTarget(raw: unknown): { target?: ScheduleTarget } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const v = raw as Record<string, unknown>;
  if (v.mode === "new") return { target: { mode: "new" } };
  if (v.mode === "current" && typeof v.sessionId === "string" && v.sessionId)
    return { target: { mode: "current", sessionId: v.sessionId } };
  if (v.mode === "session" && typeof v.sessionId === "string" && v.sessionId)
    return { target: { mode: "session", sessionId: v.sessionId } };
  return {};
}

function readDelivery(raw: unknown): { delivery?: ScheduleDelivery } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const v = raw as Record<string, unknown>;
  if (v.to === "none") return { delivery: { to: "none" } };
  if (v.to === "peer" && typeof v.peer === "string" && v.peer)
    return { delivery: { to: "peer", peer: v.peer } };
  return {};
}

function scheduleError(problem: ScheduleProblem): string {
  return t(`scheduler.errors.schedule.${problem}`);
}

/** The fields of a task being saved, checked; throws a message for the person otherwise. */
export function validateTaskInput(
  input: SaveScheduledTaskInput,
  existing: readonly ScheduledTask[],
): Omit<ScheduledTask, "id" | "armedAt" | "lastRun"> {
  const name = text(input.name);
  if (!name) throw new Error(t("scheduler.errors.nameRequired"));
  if (name.length > SCHEDULE_LIMITS.maxNameLength)
    throw new Error(t("limits.nameTooLong", { max: SCHEDULE_LIMITS.maxNameLength }));
  if (
    existing.some((task) => task.id !== input.id && task.name.toLowerCase() === name.toLowerCase())
  )
    throw new Error(t("scheduler.errors.nameTaken", { name }));
  const prompt = text(input.prompt);
  if (!prompt) throw new Error(t("scheduler.errors.promptRequired"));
  if (prompt.length > SCHEDULE_LIMITS.maxPromptLength)
    throw new Error(t("scheduler.errors.promptTooLong", { max: SCHEDULE_LIMITS.maxPromptLength }));
  const schedule = parseSchedule(input.schedule);
  if (!schedule.ok) throw new Error(scheduleError(schedule.problem));
  if (!input.id && existing.length >= SCHEDULE_LIMITS.maxTasks)
    throw new Error(t("scheduler.errors.tooMany", { max: SCHEDULE_LIMITS.maxTasks }));
  return {
    name,
    prompt,
    agentId: text(input.agentId) || DEFAULT_AGENT_ID,
    workspaceId: text(input.workspaceId) || DEFAULT_WORKSPACE_ID,
    schedule: schedule.schedule,
    enabled: input.enabled === true,
    ...(input.target ? { target: input.target } : {}),
    ...(input.delivery ? { delivery: input.delivery } : {}),
    ...(input.origin ? { origin: input.origin } : {}),
    ...(input.deleteAfterRun ? { deleteAfterRun: true } : {}),
    ...(input.silentIfEmpty ? { silentIfEmpty: true } : {}),
  };
}

/** `task-<random>`, unique among `taken`. */
export function newTaskId(taken: ReadonlySet<string>): string {
  let id = `${ID_PREFIX}${crypto.randomUUID().slice(0, 8)}`;
  while (taken.has(id)) id = `${ID_PREFIX}${crypto.randomUUID().slice(0, 8)}`;
  return id;
}

/** Title of the conversation a run creates: `⏰ <task name> – <date>`. */
export function runTitle(name: string, at: Date, locale: string): string {
  const date = at.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  return `⏰ ${name} – ${date}`;
}
