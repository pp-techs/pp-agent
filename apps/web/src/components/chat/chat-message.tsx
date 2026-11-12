import * as React from "react";
import type { ChatMessage, ChatPart } from "@workspace/shared";
import {
  Attachment,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
} from "@workspace/ui/components/attachment";
import { Badge } from "@workspace/ui/components/badge";
import { Bubble, BubbleContent } from "@workspace/ui/components/bubble";
import { Button } from "@workspace/ui/components/button";
import { Message, MessageContent, MessageFooter } from "@workspace/ui/components/message";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@workspace/ui/components/trace";
import {
  BrainIcon,
  CheckIcon,
  CircleAlertIcon,
  CopyIcon,
  FileTextIcon,
  GitBranchIcon,
  PencilIcon,
  RefreshCwIcon,
  SparklesIcon,
  WrenchIcon,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { InlineImage } from "@/components/chat/inline-image";
import { MessageEditor } from "@/components/chat/message-editor";
import { useChatThread } from "@/components/chat/chat-thread-context";
import { ToolStep } from "@/components/chat/tool-step";
import { formatDuration } from "@/lib/format-duration";
import { useChatStore } from "@/stores/chat-store";
import { cn } from "@workspace/ui/lib/utils";
import { copyText } from "@workspace/ui/lib/clipboard";

type StepPart = Extract<ChatPart, { type: "thinking" | "tool" }>;
type Block = { kind: "text"; text: string } | { kind: "steps"; parts: StepPart[] };

/** Consecutive thinking and tool parts render as one Trace; text renders as markdown between them. */
function toBlocks(parts: ChatPart[]): Block[] {
  const blocks: Block[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      blocks.push({ kind: "text", text: part.text });
    } else if (part.type === "thinking" || part.type === "tool") {
      const last = blocks.at(-1);
      if (last?.kind === "steps") last.parts.push(part);
      else blocks.push({ kind: "steps", parts: [part] });
    }
  }
  return blocks;
}

/** Text of a message as the person reads it: its text parts, tools and thinking left out. */
function messageText(parts: ChatPart[]) {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
}

const COPIED_MS = 1500;

function ActionButton({
  label,
  disabled,
  tooltip = true,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  /** Off until the message is hovered: a tooltip per button per message is costly to mount. */
  tooltip?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const props = {
    variant: "ghost",
    size: "icon-xs",
    "aria-label": label,
    disabled,
    onClick,
  } as const;
  if (!tooltip) return <Button {...props}>{children}</Button>;
  const button = <Button {...props} />;
  return (
    <Tooltip>
      <TooltipTrigger render={button}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Whether the actions under a message show their tooltips: once the pointer has been over the
 * message, and always for the last one. Until then they are plain labelled buttons.
 */
function useActionTooltips(last: boolean) {
  const [hovered, setHovered] = React.useState(false);
  const onPointerEnter = (event: React.PointerEvent<HTMLElement>) => {
    // Swapping the buttons would drop the focus of one reached with the keyboard.
    const focused = document.activeElement;
    if (focused?.closest("[data-slot=message-footer]") && event.currentTarget.contains(focused))
      return;
    setHovered(true);
  };
  return { tooltips: last || hovered, onPointerEnter: hovered ? undefined : onPointerEnter };
}

/** Why a turn failed, in one sentence, with a button that copies what the provider said. */
function ErrorNotice({ message }: { message: ChatMessage }) {
  const { t } = useTranslation("chat");
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timeout);
  }, [copied]);

  const { error, errorDetail } = message;
  function copy() {
    if (!errorDetail) return;
    copyText(`${error}\n${errorDetail}`).then(
      () => setCopied(true),
      (failure: unknown) =>
        toast.error(failure instanceof Error ? failure.message : String(failure)),
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm text-destructive">
      <CircleAlertIcon className="size-4 shrink-0" />
      <span>{error}</span>
      {errorDetail && (
        <ActionButton
          label={copied ? t("message.actions.copied") : t("message.actions.copyError")}
          onClick={copy}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </ActionButton>
      )}
    </div>
  );
}

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

/**
 * Copy, regenerate, edit, and branch under a message, with the time it was sent. Hidden until
 * hovered or focused, except under the latest message, where they stay in view.
 */
function MessageActions({
  message,
  canRegenerate,
  tooltips,
  onEdit,
  pinned = false,
}: {
  message: ChatMessage;
  canRegenerate: boolean;
  tooltips: boolean;
  onEdit?: () => void;
  /** Always in view: the latest message of the chat. */
  pinned?: boolean;
}) {
  const { t } = useTranslation("chat");
  const {
    // While an answer is being written, the commands that change the conversation wait.
    state: { busy: disabled, regenerating, branching },
    actions: { regenerate, branchSession },
  } = useChatThread();
  const temporary = useChatStore((state) => state.temporary);
  const [copied, setCopied] = React.useState(false);
  const { entryId } = message;
  const time = message.endedAt ?? message.at;

  React.useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timeout);
  }, [copied]);

  function copy() {
    copyText(messageText(message.parts)).then(
      () => setCopied(true),
      (error: unknown) => toast.error(error instanceof Error ? error.message : String(error)),
    );
  }

  // Touch screens have no hover, so the actions stay in view there.
  return (
    <MessageFooter
      className={cn(
        "gap-0.5 px-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100 pointer-coarse:opacity-100",
        pinned ? "opacity-100" : "opacity-0",
      )}
    >
      <ActionButton
        label={copied ? t("message.actions.copied") : t("message.actions.copy")}
        tooltip={tooltips}
        onClick={copy}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </ActionButton>
      {onEdit && (
        <ActionButton
          label={t("message.actions.edit")}
          disabled={disabled || !entryId}
          tooltip={tooltips}
          onClick={onEdit}
        >
          <PencilIcon />
        </ActionButton>
      )}
      {canRegenerate && (
        <ActionButton
          label={t("message.actions.regenerate")}
          disabled={disabled || regenerating}
          tooltip={tooltips}
          onClick={regenerate}
        >
          <RefreshCwIcon />
        </ActionButton>
      )}
      {!temporary && (
        <ActionButton
          label={t("message.actions.branch")}
          disabled={disabled || !entryId || branching}
          tooltip={tooltips}
          onClick={() => entryId && branchSession(entryId)}
        >
          <GitBranchIcon />
        </ActionButton>
      )}
      {time !== undefined && (
        <time
          dateTime={new Date(time).toISOString()}
          className="ms-2 text-xs font-normal text-muted-foreground tabular-nums"
        >
          {TIME_FORMAT.format(time)}
        </time>
      )}
    </MessageFooter>
  );
}

function ThinkingStep({ text, running }: { text: string; running: boolean }) {
  const [open, setOpen] = React.useState<boolean>();
  const { t } = useTranslation("chat");
  return (
    <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>
        <TraceLine status={running ? "running" : undefined}>
          <TraceIcon>
            <BrainIcon />
          </TraceIcon>
          <TraceTitle>{running ? t("message.thinking") : t("message.thought")}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="whitespace-pre-wrap">{text}</TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

type StepKind = "commands" | "reads" | "edits" | "others";

const STEP_KIND: Record<string, StepKind> = {
  bash: "commands",
  powershell: "commands",
  read: "reads",
  read_document: "reads",
  office_read: "reads",
  ls: "reads",
  find: "reads",
  grep: "reads",
  write: "edits",
  edit: "edits",
  office_edit: "edits",
};

/** What a run of steps did, counted by kind, for the one line it collapses to. */
function summarizeSteps(parts: StepPart[], t: TFunction<"chat">) {
  const counts: Record<StepKind, number> = { commands: 0, reads: 0, edits: 0, others: 0 };
  let thought = false;
  let failed = 0;
  for (const part of parts) {
    if (part.type === "thinking") {
      thought = true;
      continue;
    }
    counts[STEP_KIND[part.name] ?? "others"]++;
    if (part.status === "error") failed++;
  }
  const phrases = (["commands", "reads", "edits", "others"] as const)
    .filter((kind) => counts[kind] > 0)
    .map((kind) => t(`steps.${kind}`, { count: counts[kind] }));
  if (thought) phrases.unshift(t("message.thought"));
  const text = phrases.join(", ");
  return { text: text.charAt(0).toUpperCase() + text.slice(1), failed };
}

/**
 * A run of thinking and tool steps. It shows the steps while they work, or when one needs an
 * answer, and collapses to a one line summary once done; the person can open it either way.
 */
function StepGroup({
  parts,
  streaming,
  children,
}: {
  parts: StepPart[];
  streaming: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState<boolean>();
  const { t } = useTranslation("chat");
  const { state } = useChatThread();
  const asking = state.approvals.some((approval) =>
    parts.some((part) => part.type === "tool" && part.toolCallId === approval.anchorToolCallId),
  );
  const { text, failed } = summarizeSteps(parts, t);
  return (
    <TraceCollapsible open={open ?? (streaming || asking)} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>
        <TraceLine status={streaming ? "running" : failed > 0 ? "error" : undefined}>
          <TraceIcon>
            {parts.every((part) => part.type === "thinking") ? <BrainIcon /> : <WrenchIcon />}
          </TraceIcon>
          <TraceTitle>{text}</TraceTitle>
          {failed > 0 && (
            <TraceDescription>{t("steps.failed", { count: failed })}</TraceDescription>
          )}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-2">{children}</TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

/** What a person sent: skills, attachments and text. Shared by the sent and pending variants. */
function UserMessageContent({ message }: { message: ChatMessage }) {
  const { t } = useTranslation("chat");
  const { parts } = message;
  const text = parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  const images = parts.filter((part) => part.type === "image");
  const files = parts.filter((part) => part.type === "file");
  const skills = parts.filter((part) => part.type === "skill");
  return (
    <>
      {skills.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5 self-end">
          {skills.map((skill, index) => (
            <Badge key={index} variant="secondary">
              <SparklesIcon data-icon="inline-start" />
              {t("message.skill", { name: skill.name })}
            </Badge>
          ))}
        </div>
      )}
      {(images.length > 0 || files.length > 0) && (
        <div className="flex max-w-[80%] flex-wrap justify-end gap-2 self-end">
          {images.map((image, index) => (
            <InlineImage
              key={index}
              data={image.data}
              mimeType={image.mimeType}
              alt={t("message.attachedImage")}
              className="max-h-48 max-w-64 rounded-xl border object-cover"
            />
          ))}
          {files.map((file) => (
            <Attachment key={file.path} size="sm" title={file.path}>
              <AttachmentMedia>
                <FileTextIcon />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{file.name}</AttachmentTitle>
              </AttachmentContent>
            </Attachment>
          ))}
        </div>
      )}
      {text && (
        <Bubble align="end" variant="muted">
          <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>
        </Bubble>
      )}
    </>
  );
}

/** A message the person sent and the conversation confirmed: it can be edited, copied, branched. */
function UserMessage({ message, last }: { message: ChatMessage; last: boolean }) {
  const [editing, setEditing] = React.useState(false);
  const { tooltips, onPointerEnter } = useActionTooltips(last);
  const {
    state: { editing: saving },
    actions: { editMessage },
    meta: { bridge },
  } = useChatThread();
  if (editing && message.entryId) {
    const { entryId } = message;
    return (
      <Message align="end">
        <MessageContent>
          <MessageEditor
            bridge={bridge}
            parts={message.parts}
            pending={saving}
            onCancel={() => setEditing(false)}
            onSubmit={(edit) => editMessage(entryId, edit, () => setEditing(false))}
          />
        </MessageContent>
      </Message>
    );
  }
  return (
    <Message align="end" onPointerEnter={onPointerEnter}>
      <MessageContent>
        <UserMessageContent message={message} />
        <MessageActions
          message={message}
          canRegenerate={false}
          tooltips={tooltips}
          onEdit={() => setEditing(true)}
          pinned={last}
        />
      </MessageContent>
    </Message>
  );
}

/** Just sent, not confirmed by the conversation yet: dimmed, and without actions to wait for it. */
function PendingUserMessage({ message }: { message: ChatMessage }) {
  return (
    <Message align="end">
      <MessageContent className="opacity-70">
        <UserMessageContent message={message} />
      </MessageContent>
    </Message>
  );
}

/** Where older messages were summarized for the model; the messages above stay readable. */
function CompactionDivider() {
  const { t } = useTranslation("chat");
  return (
    <div role="separator" className="flex items-center gap-3 text-xs text-muted-foreground">
      <div className="h-px flex-1 bg-border" />
      <span>{t("message.compacted")}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Thinking, tool steps and text of a reply, in order. */
function Blocks({ blocks, streaming }: { blocks: Block[]; streaming: boolean }) {
  return blocks.map((block, index) => {
    if (block.kind === "text") {
      return (
        <Markdown key={index} streaming={streaming && index === blocks.length - 1}>
          {block.text}
        </Markdown>
      );
    }
    const active = streaming && index === blocks.length - 1;
    const steps = block.parts.map((part, partIndex) =>
      part.type === "thinking" ? (
        <ThinkingStep
          key={partIndex}
          text={part.text}
          running={active && partIndex === block.parts.length - 1}
        />
      ) : (
        <ToolStep key={part.toolCallId} part={part} />
      ),
    );
    return (
      <Trace key={index}>
        {block.parts.length > 1 ? (
          <StepGroup parts={block.parts} streaming={active}>
            {steps}
          </StepGroup>
        ) : (
          steps
        )}
      </Trace>
    );
  });
}

/**
 * A finished run folded into one line, "Worked for 1m 47s": everything the agent did before its
 * answer, from the steps to the notes between them. Closed until the person opens it.
 */
function RunCollapse({
  earlier,
  blocks,
  workedMs,
}: {
  earlier: ChatMessage[];
  blocks: Block[];
  workedMs?: number;
}) {
  const { t } = useTranslation("chat");
  const parts = [...earlier.flatMap((message) => message.parts), ...blocks.flatMap(blockParts)];
  const failed = parts.some((part) => part.type === "tool" && part.status === "error");
  const label =
    workedMs === undefined
      ? summarizeSteps(
          parts.filter(
            (part): part is StepPart => part.type === "thinking" || part.type === "tool",
          ),
          t,
        ).text
      : t("message.worked", { duration: formatDuration(workedMs) });
  return (
    <TraceCollapsible className="border-b pb-3">
      <TraceCollapsibleTrigger>
        <TraceLine status={failed ? "error" : undefined}>
          <TraceTitle>{label}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-3">
        {earlier.map((message) => (
          <React.Fragment key={message.id}>
            <Blocks blocks={toBlocks(message.parts)} streaming={false} />
            {message.error && <ErrorNotice message={message} />}
          </React.Fragment>
        ))}
        <Blocks blocks={blocks} streaming={false} />
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function blockParts(block: Block): ChatPart[] {
  return block.kind === "text" ? [{ type: "text", text: block.text }] : block.parts;
}

function AssistantMessage({
  message,
  last,
  streaming,
  earlier,
  workedMs,
}: {
  message: ChatMessage;
  last: boolean;
  streaming: boolean;
  earlier?: ChatMessage[];
  workedMs?: number;
}) {
  const { tooltips, onPointerEnter } = useActionTooltips(last);
  const blocks = toBlocks(message.parts);
  // A finished run keeps only its answer in view: the text after the last step.
  const folded = earlier !== undefined;
  const lastSteps = blocks.findLastIndex((block) => block.kind === "steps");
  const inside = folded ? blocks.slice(0, lastSteps + 1) : [];
  const shown = folded ? blocks.slice(lastSteps + 1) : blocks;
  return (
    <Message onPointerEnter={onPointerEnter}>
      <MessageContent className="gap-3">
        {folded && <RunCollapse earlier={earlier} blocks={inside} workedMs={workedMs} />}
        <Blocks blocks={shown} streaming={streaming} />
        {message.error && <ErrorNotice message={message} />}
        {!streaming && (last || blocks.some((block) => block.kind === "text")) && (
          <MessageActions
            message={message}
            canRegenerate={last}
            tooltips={tooltips}
            pinned={last}
          />
        )}
      </MessageContent>
    </Message>
  );
}

/**
 * A message of the conversation. Only what differs per message is a prop; the rest is the thread's.
 * Messages are replaced, never changed in place, so while a reply streams only its row renders.
 */
export const ChatMessageView = React.memo(
  ChatMessageViewImpl,
  // `earlier` is rebuilt with the rows; it is the same when it holds the same messages.
  (before, after) =>
    before.message === after.message &&
    before.last === after.last &&
    before.streaming === after.streaming &&
    before.workedMs === after.workedMs &&
    before.earlier?.length === after.earlier?.length &&
    (before.earlier ?? []).every((message, index) => message === after.earlier?.[index]),
);

function ChatMessageViewImpl({
  message,
  last,
  streaming,
  earlier,
  workedMs,
}: {
  message: ChatMessage;
  /** The last message of the chat: the only answer that can be regenerated. */
  last: boolean;
  streaming: boolean;
  /** The replies before this one in a finished run that did more than answer; they fold away. */
  earlier?: ChatMessage[];
  /** How long that run took. */
  workedMs?: number;
}) {
  if (message.role === "compaction") return <CompactionDivider />;
  if (message.role === "user") return <UserMessage message={message} last={last} />;
  return (
    <AssistantMessage
      message={message}
      last={last}
      streaming={streaming}
      earlier={earlier}
      workedMs={workedMs}
    />
  );
}

/** The message just sent, shown until the conversation echoes it. */
export function PendingMessageView({ message }: { message: ChatMessage }) {
  return <PendingUserMessage message={message} />;
}
