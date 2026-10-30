/**
 * Goals: the person sets an objective for a conversation (`/goal <objective>`) and the agent keeps
 * working on it, turn after turn, until it calls `complete_goal`. The host starts each follow-up
 * turn by itself (see `AgentHost.afterGoalTurn`); this file holds what is independent of it: the
 * state, the tool, the prompt texts, what a turn's outcome means, and the saved form.
 */
import { defineTool, type SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const GOAL_TOOL = "complete_goal";

/** Custom entry on the conversation's branch that records the goal; the latest one wins. */
export const GOAL_ENTRY_TYPE = "pp-agent-goal";

/** Type of the hidden message that asks the agent to carry on; the chat does not show it. */
export const GOAL_CONTINUE_TYPE = "pp-agent-goal-continue";

export const MAX_OBJECTIVE_LENGTH = 4000;

export interface Goal {
  objective: string;
  status: "active" | "paused";
  /**
   * The last turn made no tool call, so the agent is waiting on the person (or has nothing left to
   * do). It is not continued by itself until the person writes again or resumes the goal.
   */
  stalled: boolean;
}

/** What follows a turn that ran under an active goal. */
export type GoalOutcome = "continue" | "pause" | "stall";

/**
 * `pause` when the turn ended in an error or was stopped; `stall` when it made no tool call (it
 * answered or asked something instead of working); `continue` otherwise.
 */
export function goalOutcome(turn: {
  stopReason: string | undefined;
  toolCalls: number;
}): GoalOutcome {
  if (turn.stopReason === "aborted" || turn.stopReason === "error") return "pause";
  return turn.toolCalls === 0 ? "stall" : "continue";
}

/** Text of the hidden message that starts every turn after the first. */
export function goalContinuation(goal: Goal): string {
  return [
    `Continue working toward the goal: ${goal.objective}`,
    `Take the next concrete step. When the goal is fully achieved and checked, call ${GOAL_TOOL} with a short summary. If you need something from the person, say so and wait.`,
  ].join("\n");
}

/** System prompt section while the goal is active; null otherwise. */
export function goalSection(goal: Goal | null): string | null {
  if (!goal || goal.status !== "active") return null;
  return [
    "## Goal",
    `The person set a goal for this conversation: ${goal.objective}`,
    "Keep working toward it. After each turn you are asked to continue, so do not stop to ask whether to go on. Use your tools to make progress, and check the result before you call it done.",
    `When the goal is achieved, call ${GOAL_TOOL} with a short summary of what was done; that ends the goal. Do not call it early or to give up. If you are stuck or need a decision from the person, say so plainly and wait instead of repeating yourself.`,
  ].join("\n");
}

export interface GoalHost {
  /** The conversation's goal right now, if any. */
  current(): Goal | null;
  /** Ends the active goal. */
  complete(): void;
}

export function createGoalTool(host: GoalHost) {
  return defineTool({
    name: GOAL_TOOL,
    label: "Goal",
    description:
      "Reports that the conversation's goal is achieved and ends it. Call it only when the goal is fully done and checked.",
    promptSnippet: "End the goal once it is achieved",
    parameters: Type.Object({
      summary: Type.String({
        minLength: 1,
        maxLength: 1000,
        description: "What was done, in a sentence or two",
      }),
    }),
    async execute(_toolCallId, params) {
      if (host.current()?.status !== "active") throw new Error("There is no active goal.");
      host.complete();
      return {
        content: [
          {
            type: "text",
            text: `Goal complete: ${params.summary}\nTell the person what was done.`,
          },
        ],
        details: undefined,
      };
    },
  });
}

/** What the conversation's branch records; `objective: null` means the goal ended. */
export interface GoalEntry {
  objective: string | null;
  status?: Goal["status"];
}

export function goalEntry(goal: Goal | null): GoalEntry {
  return goal ? { objective: goal.objective, status: goal.status } : { objective: null };
}

/**
 * The goal a saved conversation had, paused: nothing carries on by itself in a conversation that
 * was closed, the person resumes it.
 */
export function readGoal(manager: SessionManager): Goal | null {
  const branch = manager.getBranch();
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type !== "custom" || entry.customType !== GOAL_ENTRY_TYPE) continue;
    const data = entry.data as GoalEntry | undefined;
    if (typeof data?.objective !== "string" || !data.objective) return null;
    return { objective: data.objective, status: "paused", stalled: false };
  }
  return null;
}
