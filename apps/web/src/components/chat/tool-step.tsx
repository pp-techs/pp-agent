import type { ApprovalRequest, ChatMessage, ChatPart } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { CodeBlock, CodeBlockContent } from "@workspace/ui/components/code-block";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@workspace/ui/components/trace";
import {
  BanIcon,
  BlocksIcon,
  BotIcon,
  BrainIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  ClockIcon,
  CodeIcon,
  FileTextIcon,
  FolderOpenIcon,
  ListChecksIcon,
  type LucideIcon,
  SaveIcon,
  SearchIcon,
  ShieldQuestionIcon,
  WrenchIcon,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { useChatStore } from "@/stores/chat-store";

type ToolPart = Extract<ChatPart, { type: "tool" }>;

const ICONS: Record<string, LucideIcon> = {
  read: FileTextIcon,
  read_document: FileTextIcon,
  ls: FolderOpenIcon,
  find: SearchIcon,
  grep: SearchIcon,
  write: SaveIcon,
  current_datetime: ClockIcon,
  codemode: CodeIcon,
  tool_search: SearchIcon,
  memory_save: BrainIcon,
  memory_forget: BrainIcon,
  memory_list: BrainIcon,
  memory_search: BrainIcon,
  todo_write: ListChecksIcon,
  delegate_task: BotIcon,
  office_read: FileTextIcon,
  office_edit: SaveIcon,
};

function stringArg(args: Record<string, unknown>, key: string) {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

type StepState = "active" | "done" | "notDone";

/** Plain-language step titles for people who do not know what `grep` is. */
function stepTitle(part: ToolPart, t: TFunction<"chat">) {
  // In progress, finished, or not done (declined or failed).
  const state: StepState =
    part.status === "running" || part.status === "awaiting-approval"
      ? "active"
      : part.status === "done"
        ? "done"
        : "notDone";
  // Attached files are stored as attachments/<timestamp>-<name>; show the name the person picked.
  const path = stringArg(part.args, "path")?.replace(/\b(attachments\/)\d{8}-\d{6}-\d{3}-/, "$1");
  const pattern = stringArg(part.args, "pattern");
  switch (part.name) {
    case "read":
    case "read_document":
      return t(`toolStep.titles.read.${state}`, { target: path ?? t("toolStep.fallbacks.file") });
    case "write":
      return t(`toolStep.titles.write.${state}`, { target: path ?? t("toolStep.fallbacks.file") });
    case "ls":
      return t(`toolStep.titles.ls.${state}`, {
        target: path ?? t("toolStep.fallbacks.workspace"),
      });
    case "find":
      return t(`toolStep.titles.find.${state}`, {
        target: pattern ?? t("toolStep.fallbacks.pattern"),
      });
    case "grep":
      return t(`toolStep.titles.grep.${state}`, {
        target: pattern ?? t("toolStep.fallbacks.text"),
      });
    case "current_datetime":
      return t(`toolStep.titles.currentDatetime.${state}`);
    case "codemode":
      return t(`toolStep.titles.codemode.${state}`);
    case "tool_search":
      return t(`toolStep.titles.toolSearch.${state}`);
    case "memory_save":
      return t(`toolStep.titles.memorySave.${state}`);
    case "memory_forget":
      return t(`toolStep.titles.memoryForget.${state}`);
    case "memory_list":
      return t(`toolStep.titles.memoryList.${state}`);
    case "memory_search":
      return t(`toolStep.titles.memorySearch.${state}`);
    case "todo_write":
      return t(`toolStep.titles.todo.${state}`);
    case "delegate_task":
      return t(`toolStep.titles.delegate.${state}`);
  }
  // MCP tools are named mcp__<server>__<tool>.
  const mcp = /^mcp__(.+?)__(.+)$/.exec(part.name);
  return mcp
    ? t(`toolStep.titles.mcp.${state}`, { tool: mcp[2], server: mcp[1] })
    : t(`toolStep.titles.other.${state}`, { name: part.name });
}

function ApprovalCard({
  approval,
  onRespond,
  responding,
}: {
  approval: ApprovalRequest;
  onRespond: (requestId: string, approved: boolean) => void;
  responding: boolean;
}) {
  const { t } = useTranslation("chat");
  return (
    <Item variant="outline" size="sm" className="w-full">
      <ItemMedia variant="icon">
        <ShieldQuestionIcon />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>{t("toolStep.approval.question", { title: approval.title })}</ItemTitle>
        <ItemDescription>{t("toolStep.approval.description")}</ItemDescription>
        {approval.detail && (
          <CodeBlock size="sm" className="mt-2">
            <CodeBlockContent wrap className="max-h-48">
              {approval.detail}
            </CodeBlockContent>
          </CodeBlock>
        )}
      </ItemContent>
      <ItemActions>
        <Button
          size="sm"
          variant="outline"
          disabled={responding}
          onClick={() => onRespond(approval.requestId, false)}
        >
          {t("toolStep.approval.deny")}
        </Button>
        <Button size="sm" disabled={responding} onClick={() => onRespond(approval.requestId, true)}>
          {t("toolStep.approval.approve")}
        </Button>
      </ItemActions>
    </Item>
  );
}

/** Id of the newest `todo_write` call in the chat. */
function latestTodoCallId(state: { messages: ChatMessage[] }): string | undefined {
  for (const message of state.messages.toReversed()) {
    for (const part of message.parts.toReversed()) {
      if (part.type === "tool" && part.name === "todo_write") return part.toolCallId;
    }
  }
  return undefined;
}

interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "done";
}

/** The checklist in a `todo_write` call's arguments; arguments still streaming may be incomplete. */
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

/** The model's checklist as a compact card; it is the call's own arguments, so it updates live. */
function TodoCard({ items }: { items: TodoItem[] }) {
  const { t } = useTranslation("chat");
  const done = items.filter((item) => item.status === "done").length;
  return (
    <Item variant="outline" size="sm" className="w-full">
      <ItemMedia variant="icon">
        <ListChecksIcon />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>
          {t("toolStep.todo.title")}
          <span className="text-xs font-normal text-muted-foreground">
            {t("toolStep.todo.progress", { done, total: items.length })}
          </span>
        </ItemTitle>
        {items.length === 0 ? (
          <ItemDescription>{t("toolStep.todo.empty")}</ItemDescription>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {items.map((item, index) => {
              const StatusIcon = TODO_ICONS[item.status];
              return (
                <li
                  key={index}
                  aria-label={`${item.content} — ${t(`toolStep.todo.status.${item.status}`)}`}
                  className={`flex items-start gap-2 text-sm ${
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
      </ItemContent>
    </Item>
  );
}

/** Steps the helper of `delegate_task` has taken so far: `<tool name>\t<what it works on>` lines. */
function HelperProgress({ output }: { output: string }) {
  const { t } = useTranslation("chat");
  const steps = output
    .split("\n")
    .map((line) => line.split("\t"))
    .slice(-6);
  return (
    <ul
      aria-label={t("toolStep.helper.working")}
      className="flex flex-col gap-0.5 pl-6 text-xs text-muted-foreground"
    >
      {steps.map(([tool, target], index) => (
        <li key={index} className="truncate">
          <span className="font-mono">{tool}</span>
          {target ? ` · ${target}` : ""}
        </li>
      ))}
    </ul>
  );
}

export function ToolStep({
  part,
  approvals,
  onRespond,
  responding,
}: {
  part: ToolPart;
  /** Pending approvals anchored to this step: its own call, or calls a script inside it makes. */
  approvals: ApprovalRequest[];
  onRespond: (requestId: string, approved: boolean) => void;
  responding: boolean;
}) {
  const { t } = useTranslation("chat");
  // Only the newest checklist of the chat is a card; earlier versions collapse into a step.
  const latestTodoId = useChatStore(latestTodoCallId);
  const Icon = ICONS[part.name] ?? (part.name.startsWith("mcp__") ? BlocksIcon : WrenchIcon);
  const cards = approvals.map((approval) => (
    <ApprovalCard
      key={approval.requestId}
      approval={approval}
      onRespond={onRespond}
      responding={responding}
    />
  ));

  // A pending approval for this call is a question to the person, not activity, so it replaces the line.
  if (approvals.some((approval) => approval.toolCallId === part.toolCallId)) return <>{cards}</>;

  // The checklist is one card that changes as the model rewrites it; older versions collapse.
  if (part.name === "todo_write" && part.toolCallId === latestTodoId && part.status !== "denied")
    return <TodoCard items={todoItems(part.args)} />;

  const status =
    part.status === "running" ? "running" : part.status === "error" ? "error" : undefined;
  const line = (
    <TraceLine status={status}>
      <TraceIcon>{part.status === "denied" ? <BanIcon /> : <Icon />}</TraceIcon>
      <TraceTitle>{stepTitle(part, t)}</TraceTitle>
      {part.status === "denied" && <TraceDescription>{t("toolStep.declined")}</TraceDescription>}
      {part.status === "error" && <TraceDescription>{t("toolStep.failed")}</TraceDescription>}
    </TraceLine>
  );

  // While the helper works, its output is the list of its steps; the summary replaces it at the end.
  const helperWorking = part.name === "delegate_task" && part.status === "running";
  const step =
    part.output && !helperWorking ? (
      <TraceCollapsible>
        <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <CodeBlock size="sm">
            <CodeBlockContent wrap className="max-h-64">
              {part.output}
            </CodeBlockContent>
          </CodeBlock>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    ) : (
      line
    );

  return (
    <>
      {step}
      {helperWorking && part.output && <HelperProgress output={part.output} />}
      {cards}
    </>
  );
}
