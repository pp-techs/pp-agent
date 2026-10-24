/**
 * `todo_write`: a checklist the model keeps for tasks with several steps. It only mutates what the
 * chat shows, so it needs no approval. The list is the tool call's own arguments: the chat reads
 * them from the transcript (live while streaming, and again when a saved conversation reopens), so
 * nothing else is stored.
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const TODO_TOOL = "todo_write";

const MAX_ITEMS = 30;
const MAX_ITEM_LENGTH = 200;

const MARKS = { pending: "[ ]", in_progress: "[~]", done: "[x]" } as const;

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
    async execute(_toolCallId, params) {
      const todos = params.todos.slice(0, MAX_ITEMS);
      const done = todos.filter((todo) => todo.status === "done").length;
      const lines = todos.map((todo) => `${MARKS[todo.status]} ${todo.content}`);
      return {
        content: [
          {
            type: "text",
            text: `Checklist updated (${done}/${todos.length} done).\n${lines.join("\n")}`,
          },
        ],
        details: undefined,
      };
    },
  });
}
