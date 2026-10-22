import * as React from "react";
import type { DesktopBridge } from "@workspace/shared";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
} from "@workspace/ui/components/attachment";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@workspace/ui/components/input-group";
import { ArrowUpIcon, FileTextIcon, PaperclipIcon, SquareIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { useAgentCommands } from "@/lib/queries";
import { useChatStore } from "@/stores/chat-store";
import { toAttachments, useComposerStore } from "@/stores/composer-store";

export function PromptComposer({ bridge, disabled }: { bridge: DesktopBridge; disabled: boolean }) {
  const [draft, setDraft] = React.useState("");
  const formRef = React.useRef<HTMLFormElement>(null);
  const running = useChatStore((state) => state.status === "running");
  const attachments = useComposerStore((state) => state.attachments);
  const { add, remove, clear, restore } = useComposerStore.getState();
  const { prompt, abort } = useAgentCommands(bridge);
  const canSend = !disabled && (draft.trim().length > 0 || attachments.length > 0);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;
    const text = draft;
    const sent = attachments;
    setDraft("");
    clear();
    prompt.mutate(
      { text, attachments: sent.map(({ id: _id, ...attachment }) => attachment) },
      {
        onError: (error) => {
          setDraft(text);
          restore(sent);
          toast.error(error.message);
        },
      },
    );
  }

  async function pick() {
    try {
      add(await bridge.files.pick());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function onPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    try {
      add(await toAttachments(bridge, files));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="mx-auto w-full max-w-3xl px-6 pb-6">
      <InputGroup>
        {attachments.length > 0 && (
          <InputGroupAddon align="block-start" className="flex-wrap gap-2">
            {attachments.map((attachment) => (
              <Attachment key={attachment.id} size="sm">
                <AttachmentMedia variant={attachment.data ? "image" : "icon"}>
                  {attachment.data ? (
                    <img src={`data:${attachment.mimeType};base64,${attachment.data}`} alt="" />
                  ) : (
                    <FileTextIcon />
                  )}
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{attachment.name}</AttachmentTitle>
                </AttachmentContent>
                <AttachmentActions>
                  <AttachmentAction
                    aria-label={`Remove ${attachment.name}`}
                    onClick={() => remove(attachment.id)}
                  >
                    <XIcon />
                  </AttachmentAction>
                </AttachmentActions>
              </Attachment>
            ))}
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={(event) => void onPaste(event)}
          placeholder={disabled ? "Connect a model in Settings to start" : "Ask the agent…"}
          aria-label="Message"
          className="min-h-14"
          disabled={disabled}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              formRef.current?.requestSubmit();
            }
          }}
        />
        <InputGroupAddon align="block-end" className="pt-1">
          <InputGroupButton
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Attach files"
            disabled={disabled}
            onClick={() => void pick()}
          >
            <PaperclipIcon />
          </InputGroupButton>
          <InputGroupText className="text-xs">
            {running
              ? "Messages you send now run after this reply."
              : "Enter to send, Shift+Enter for a new line. Drop or paste files to attach."}
          </InputGroupText>
          {running && (
            <InputGroupButton
              type="button"
              variant="outline"
              size="icon-sm"
              className="ml-auto"
              aria-label="Stop"
              onClick={() =>
                abort.mutate(undefined, { onError: (error) => toast.error(error.message) })
              }
            >
              <SquareIcon />
            </InputGroupButton>
          )}
          <InputGroupButton
            type="submit"
            variant="default"
            size="icon-sm"
            disabled={!canSend}
            className={running ? undefined : "ml-auto"}
            aria-label="Send"
          >
            <ArrowUpIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
