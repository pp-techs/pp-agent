/**
 * `todo_write`: a checklist the model keeps for tasks with several steps. It only mutates what the
 * chat shows, so it needs no approval. The list is the tool call's own arguments: the chat reads
 * them from the transcript (live while streaming, and again when a saved conversation reopens), so
 * nothing else is stored.
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const TODO_TOOL = "todo_write";

/** Type of the hidden message that asks the agent to bring its checklist up to date; the chat does not show it. */
export const TODO_REMINDER_TYPE = "pp-agent-todo-reminder";

const MAX_ITEMS = 30;
const MAX_ITEM_LENGTH = 200;

const MARKS = { pending: "[ ]", in_progress: "[~]", done: "[x]" } as const;

export type TodoStatus = keyof typeof MARKS;

export interface TodoEntry {
  content: string;
  status: TodoStatus;
}

/** The checklist in a `todo_write` call's arguments; anything malformed is skipped. */
function parseTodos(args: unknown): TodoEntry[] {
  if (typeof args !== "object" || args === null) return [];
  let todos: unknown = (args as { todos?: unknown }).todos;
  if (typeof todos === "string") {
    try {
      todos = JSON.parse(todos);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(todos)) return [];
  const items: TodoEntry[] = [];
  for (const item of todos as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const { content, status } = item as { content?: unknown; status?: unknown };
    if (typeof content !== "string" || !content) continue;
    items.push({
      content,
      status: status === "done" || status === "in_progress" ? status : "pending",
    });
  }
  return items;
}

/**
 * Items of the newest checklist written since the person's last message that are not done; empty
 * when the agent wrote no checklist in this run or finished it. The messages are the session's.
 */
export function unfinishedTodos(messages: readonly unknown[]): TodoEntry[] {
  let latest: TodoEntry[] | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: string; content?: unknown } | undefined;
    if (message?.role === "user") break;
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (let block = message.content.length - 1; block >= 0; block -= 1) {
      const part = message.content[block] as { type?: string; name?: string; arguments?: unknown };
      if (part?.type !== "toolCall" || part.name !== TODO_TOOL) continue;
      latest = parseTodos(part.arguments);
      break;
    }
    if (latest) break;
  }
  return (latest ?? []).filter((todo) => todo.status !== "done");
}

/** Text of the hidden message sent when a run ended with checklist items still open. */
export function todoReminder(open: readonly TodoEntry[]): string {
  const lines = open.map((todo) => `${MARKS[todo.status]} ${todo.content}`);
  return [
    "Your checklist still has items that are not marked done:",
    ...lines,
    `If the work behind them is finished, call ${TODO_TOOL} now with the whole list and every finished item marked done. Do not write any other text or repeat your answer. If you stopped because you need something from the person, call nothing and reply with just "OK".`,
  ].join("\n");
}

export function createTodoTool() {
  return defineTool({
    name: TODO_TOOL,
    label: "Checklist",
    description:
      "Writes the checklist for the current task. Send the complete list every time (it replaces the previous one). " +
      "Each item has a short description and a status: pending, in_progress (at most one at a time) or done. " +
      "The user sees the list as a live checklist.",
    promptSnippet: "Keep a checklist for tasks with several steps",
    parameters: Type.Object({
      todos: Type.Array(
        Type.Object({
          content: Type.String({
            minLength: 1,
            maxLength: MAX_ITEM_LENGTH,
            description: "What needs to be done, in a few words",
          }),
          status: Type.Union(
            [Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("done")],
            { description: "pending, in_progress or done" },
          ),
        }),
        { maxItems: MAX_ITEMS, description: "The whole checklist, in order" },
      ),
    }),
    prepareArguments: (args) => {
      if (!args || typeof args !== "object" || Array.isArray(args)) return args as never;
      const raw = { ...(args as Record<string, unknown>) };
      if (typeof raw.todos === "string") {
        try {
          raw.todos = JSON.parse(raw.todos);
        } catch {}
      }
      return raw as never;
    },
    async execute(_toolCallId, params) {
      const todos = params.todos.slice(0, MAX_ITEMS);
      const done = todos.filter((todo) => todo.status === "done").length;
      const lines = todos.map((todo) => `${MARKS[todo.status]} ${todo.content}`);
      const next =
        done < todos.length
          ? `\nCall ${TODO_TOOL} again as soon as an item starts or finishes, and once more with every item done before you give your final answer.`
          : "";
      return {
        content: [
          {
            type: "text",
            text: `Checklist updated (${done}/${todos.length} done).\n${lines.join("\n")}${next}`,
          },
        ],
        details: undefined,
      };
    },
  });
}
