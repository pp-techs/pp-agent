import type { ChatMessage } from "@workspace/shared";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import {
  ChevronDownIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  ListChecksIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { useChatStore } from "@/stores/chat-store";

interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "done";
}

/** Arguments of the newest `todo_write` call of the chat (a stable reference between updates). */
function latestTodoArgs(state: { messages: ChatMessage[] }): Record<string, unknown> | undefined {
  for (const message of state.messages.toReversed()) {
    for (const part of message.parts.toReversed()) {
      if (part.type === "tool" && part.name === "todo_write" && part.status !== "denied")
        return part.args;
    }
  }
  return undefined;
}

/** The checklist in a call's arguments; arguments still streaming may be incomplete. */
function todoItems(args: Record<string, unknown>): TodoItem[] {
  if (!Array.isArray(args.todos)) return [];
  const items: TodoItem[] = [];
  for (const item of args.todos as unknown[]) {
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

const TODO_ICONS: Record<TodoItem["status"], LucideIcon> = {
  pending: CircleDashedIcon,
  in_progress: CircleDotIcon,
  done: CircleCheckIcon,
};

/**
 * The model's checklist, pinned above the message box so it stays in view while the chat scrolls.
 * It is the newest `todo_write` call's own arguments, so it updates live; collapsed, it shows the
 * progress and the item in progress.
 */
export function TodoPanel() {
  const { t } = useTranslation("chat");
  const args = useChatStore(latestTodoArgs);
  if (!args) return null;

  const items = todoItems(args);

  const done = items.filter((item) => item.status === "done").length;
  const current = items.find((item) => item.status === "in_progress");

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-2">
      <Collapsible
        defaultOpen
        className="rounded-2xl border bg-muted/40 text-sm"
        aria-label={t("toolStep.todo.title")}
      >
        <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-2xl px-3 py-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <ListChecksIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="font-medium">{t("toolStep.todo.title")}</span>
          <span className="text-xs text-muted-foreground">
            {t("toolStep.todo.progress", { done, total: items.length })}
          </span>
          {current && (
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground group-aria-expanded:hidden">
              · {current.content}
            </span>
          )}
          <ChevronDownIcon
            aria-hidden
            className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-aria-expanded:rotate-180"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          {items.length === 0 ? (
            <p className="px-3 pb-2 text-muted-foreground">{t("toolStep.todo.empty")}</p>
          ) : (
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto px-3 pb-2">
              {items.map((item, index) => {
                const StatusIcon = TODO_ICONS[item.status];
                return (
                  <li
                    key={index}
                    aria-label={`${item.content} — ${t(`toolStep.todo.status.${item.status}`)}`}
                    className={`flex items-start gap-2 ${
                      item.status === "done"
                        ? "text-muted-foreground line-through"
                        : item.status === "in_progress"
                          ? "font-medium"
                          : ""
                    }`}
                  >
                    <StatusIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0">{item.content}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
