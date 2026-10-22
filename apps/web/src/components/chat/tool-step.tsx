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

/** Verb forms per tool: in progress, finished, and not done (declined or failed). */
const VERBS: Record<string, [string, string, string]> = {
  read: ["Reading", "Read", "Read"],
  read_document: ["Reading", "Read", "Read"],
  ls: ["Looking in", "Looked in", "Look in"],
  find: ["Finding files matching", "Found files matching", "Find files matching"],
  grep: ["Searching for", "Searched for", "Search for"],
  write: ["Saving", "Saved", "Save"],
  current_datetime: ["Checking", "Checked", "Check"],
  codemode: ["Running", "Ran", "Run"],
  tool_search: ["Looking for", "Looked for", "Look for"],
};

/** Plain-language step titles for people who do not know what `grep` is. */
function stepTitle(part: ToolPart) {
  const [active, done, notDone] = VERBS[part.name] ?? ["Using", "Used", "Use"];
  const verb =
    part.status === "running" || part.status === "awaiting-approval"
      ? active
      : part.status === "done"
        ? done
        : notDone;
  // Attached files are stored as attachments/<timestamp>-<name>; show the name the person picked.
  const path = stringArg(part.args, "path")?.replace(/\b(attachments\/)\d{8}-\d{6}-\d{3}-/, "$1");
  const pattern = stringArg(part.args, "pattern");
  switch (part.name) {
    case "read":
    case "read_document":
    case "write":
      return `${verb} ${path ?? "a file"}`;
    case "ls":
      return `${verb} ${path ?? "the workspace"}`;
    case "find":
      return `${verb} ${pattern ?? "a pattern"}`;
    case "grep":
      return `${verb} “${pattern ?? "text"}”`;
    case "current_datetime":
      return `${verb} the date and time`;
    case "codemode":
      return `${verb} a script`;
    case "tool_search":
      return `${verb} the right tool`;
  }
  // MCP tools are named mcp__<server>__<tool>.
  const mcp = /^mcp__(.+?)__(.+)$/.exec(part.name);
  return mcp ? `${verb} “${mcp[2]}” in ${mcp[1]}` : `${verb} ${part.name}`;
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
  return (
    <Item variant="outline" size="sm" className="w-full">
      <ItemMedia variant="icon">
        <ShieldQuestionIcon />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>{approval.title}?</ItemTitle>
        <ItemDescription>
          The agent wants to make a change. Review it before it happens.
        </ItemDescription>
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
          Deny
        </Button>
        <Button size="sm" disabled={responding} onClick={() => onRespond(approval.requestId, true)}>
          Approve
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
      <TraceTitle>{stepTitle(part)}</TraceTitle>
      {part.status === "denied" && <TraceDescription>Declined</TraceDescription>}
      {part.status === "error" && <TraceDescription>Failed</TraceDescription>}
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
