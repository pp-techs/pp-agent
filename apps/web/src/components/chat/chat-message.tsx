import * as React from "react";
import type { ApprovalRequest, ChatMessage, ChatPart } from "@workspace/shared";
import {
  Attachment,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
} from "@workspace/ui/components/attachment";
import { Badge } from "@workspace/ui/components/badge";
import { Bubble, BubbleContent } from "@workspace/ui/components/bubble";
import { Message, MessageContent } from "@workspace/ui/components/message";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@workspace/ui/components/trace";
import { BrainIcon, CircleAlertIcon, FileTextIcon, SparklesIcon } from "lucide-react";

import { Markdown } from "@/components/markdown";
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

function ThinkingStep({ text, running }: { text: string; running: boolean }) {
  const [open, setOpen] = React.useState<boolean>();
  return (
    <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>
        <TraceLine status={running ? "running" : undefined}>
          <TraceIcon>
            <BrainIcon />
          </TraceIcon>
          <TraceTitle>{running ? "Thinking" : "Thought"}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="whitespace-pre-wrap">{text}</TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function UserMessage({ parts }: { parts: ChatPart[] }) {
  const text = parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  const images = parts.filter((part) => part.type === "image");
  const files = parts.filter((part) => part.type === "file");
  const skills = parts.filter((part) => part.type === "skill");
  return (
    <Message align="end">
      <MessageContent>
        {skills.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5 self-end">
            {skills.map((skill, index) => (
              <Badge key={index} variant="secondary">
                <SparklesIcon data-icon="inline-start" />
                Skill: {skill.name}
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
                alt="Attached image"
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
      </MessageContent>
    </Message>
  );
}

export function ChatMessageView({
  message,
  streaming,
  approvals,
  onRespond,
  responding,
}: {
  message: ChatMessage;
  streaming: boolean;
  approvals: ApprovalRequest[];
  onRespond: (requestId: string, approved: boolean) => void;
  responding: boolean;
}) {
  if (message.role === "user") return <UserMessage parts={message.parts} />;

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
                  <ToolStep
                    key={part.toolCallId}
                    part={part}
                    approvals={approvals.filter(
                      (approval) => approval.anchorToolCallId === part.toolCallId,
                    )}
                    onRespond={onRespond}
                    responding={responding}
                  />
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
      </MessageContent>
    </Message>
  );
}
