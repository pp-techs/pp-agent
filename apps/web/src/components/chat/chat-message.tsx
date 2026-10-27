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
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { MessageEditor } from "@/components/chat/message-editor";
import { useChatThread } from "@/components/chat/chat-thread-context";
import { ToolStep } from "@/components/chat/tool-step";

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
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Copy, regenerate, edit, and branch under a message. Hidden until hovered or focused. */
function MessageActions({
  message,
  canRegenerate,
  onEdit,
}: {
  message: ChatMessage;
  canRegenerate: boolean;
  onEdit?: () => void;
}) {
  const { t } = useTranslation("chat");
  const {
    // While an answer is being written, the commands that change the conversation wait.
    state: { busy: disabled },
    actions: { regenerate, branchSession },
  } = useChatThread();
  const [copied, setCopied] = React.useState(false);
  const { entryId } = message;
  const onError = (error: Error) => toast.error(error.message);

  React.useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timeout);
  }, [copied]);

  function copy() {
    navigator.clipboard.writeText(messageText(message.parts)).then(
      () => setCopied(true),
      (error: unknown) => toast.error(error instanceof Error ? error.message : String(error)),
    );
  }

  return (
    <MessageFooter className="gap-0.5 px-0 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100">
      <ActionButton
        label={copied ? t("message.actions.copied") : t("message.actions.copy")}
        onClick={copy}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </ActionButton>
      {onEdit && (
        <ActionButton
          label={t("message.actions.edit")}
          disabled={disabled || !entryId}
          onClick={onEdit}
        >
          <PencilIcon />
        </ActionButton>
      )}
      {canRegenerate && (
        <ActionButton
          label={t("message.actions.regenerate")}
          disabled={disabled || regenerate.isPending}
          onClick={() => regenerate.mutate(undefined, { onError })}
        >
          <RefreshCwIcon />
        </ActionButton>
      )}
      <ActionButton
        label={t("message.actions.branch")}
        disabled={disabled || !entryId || branchSession.isPending}
        onClick={() => entryId && branchSession.mutate(entryId, { onError })}
      >
        <GitBranchIcon />
      </ActionButton>
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
            <img
              key={index}
              src={`data:${image.mimeType};base64,${image.data}`}
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
function UserMessage({ message }: { message: ChatMessage }) {
  const [editing, setEditing] = React.useState(false);
  const {
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
            pending={editMessage.isPending}
            onCancel={() => setEditing(false)}
            onSubmit={(edit) =>
              editMessage.mutate(
                { entryId, ...edit },
                {
                  onSuccess: () => setEditing(false),
                  onError: (error) => toast.error(error.message),
                },
              )
            }
          />
        </MessageContent>
      </Message>
    );
  }
  return (
    <Message align="end">
      <MessageContent>
        <UserMessageContent message={message} />
        <MessageActions message={message} canRegenerate={false} onEdit={() => setEditing(true)} />
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

/** A message of the conversation. Only what differs per message is a prop; the rest is the thread's. */
export function ChatMessageView({
  message,
  last,
  streaming,
}: {
  message: ChatMessage;
  /** The last message of the chat: the only answer that can be regenerated. */
  last: boolean;
  streaming: boolean;
}) {
  if (message.role === "compaction") return <CompactionDivider />;
  if (message.role === "user") return <UserMessage message={message} />;

  const blocks = toBlocks(message.parts);
  return (
    <Message>
      <MessageContent className="gap-3">
        {blocks.map((block, index) =>
          block.kind === "text" ? (
            <Markdown key={index} streaming={streaming && index === blocks.length - 1}>
              {block.text}
            </Markdown>
          ) : (
            <Trace key={index}>
              {block.parts.map((part, partIndex) =>
                part.type === "thinking" ? (
                  <ThinkingStep
                    key={partIndex}
                    text={part.text}
                    running={
                      streaming &&
                      index === blocks.length - 1 &&
                      partIndex === block.parts.length - 1
                    }
                  />
                ) : (
                  <ToolStep key={part.toolCallId} part={part} />
                ),
              )}
            </Trace>
          ),
        )}
        {message.error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <CircleAlertIcon className="size-4 shrink-0" />
            <span>{message.error}</span>
          </div>
        )}
        {!streaming && (last || blocks.some((block) => block.kind === "text")) && (
          <MessageActions message={message} canRegenerate={last} />
        )}
      </MessageContent>
    </Message>
  );
}

/** The message just sent, shown until the conversation echoes it. */
export function PendingMessageView({ message }: { message: ChatMessage }) {
  return <PendingUserMessage message={message} />;
}
