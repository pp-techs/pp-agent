import type { AgentCommandMap, GoalSummary } from "@workspace/shared";

export type GoalParams = AgentCommandMap["set_goal"]["params"];

/**
 * `/goal <objective>` starts a goal; `/goal pause`, `/goal resume` and `/goal clear` manage it.
 * Null for anything else, and for a bare `/goal` (the command itself handles that).
 */
export function parseGoalCommand(draft: string): GoalParams | null {
  const match = /^\/goal\s+(\S[\s\S]*)$/i.exec(draft.trim());
  if (!match) return null;
  const rest = (match[1] ?? "").trim();
  const word = rest.toLowerCase();
  if (word === "pause" || word === "resume" || word === "clear") return { action: word };
  return { action: "start", objective: rest };
}

/** Key in the `chat` namespace of the words for where the goal stands. */
export function goalStatusKey(goal: GoalSummary) {
  if (goal.status === "paused") return "goal.status.paused";
  return goal.waiting ? "goal.status.waiting" : "goal.status.active";
}
