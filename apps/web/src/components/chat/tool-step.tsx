import type { ApprovalRequest, ChatPart } from "@workspace/shared";
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
  ClockIcon,
  CodeIcon,
  FileTextIcon,
  FolderOpenIcon,
  type LucideIcon,
  SaveIcon,
  SearchIcon,
  ShieldQuestionIcon,
  WrenchIcon,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

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

  const step = part.output ? (
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
      {cards}
    </>
  );
}
