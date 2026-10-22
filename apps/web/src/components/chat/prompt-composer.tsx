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
  InputGroupTextarea,
} from "@workspace/ui/components/input-group";
import { ArrowUpIcon, FileTextIcon, SquareIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { ComposerMenu } from "@/components/chat/composer-menu";
import { ModelPicker } from "@/components/chat/model-picker";
import { SlashSuggestions } from "@/components/chat/slash-suggestions";
import { ThinkingPicker } from "@/components/chat/thinking-picker";
import { useSendMessage } from "@/hooks/use-send-message";
import { useAgentCommands } from "@/lib/queries";
import {
  filterSlashItems,
  findTypedCommand,
  focusComposer,
  type SlashItem,
  slashQuery,
  slashText,
  useSlashItems,
} from "@/lib/slash-commands";
import { useChatStore } from "@/stores/chat-store";
import { toAttachments, useComposerStore } from "@/stores/composer-store";

export function PromptComposer({ bridge, disabled }: { bridge: DesktopBridge; disabled: boolean }) {
  const formRef = React.useRef<HTMLFormElement>(null);
  const running = useChatStore((state) => state.status === "running");
  const draft = useComposerStore((state) => state.draft);
  const attachments = useComposerStore((state) => state.attachments);
  const { setDraft, add, remove } = useComposerStore.getState();
  const { abort } = useAgentCommands(bridge);
  const send = useSendMessage(bridge);
  const { commands, skills } = useSlashItems(bridge);
  const canSend = !disabled && (draft.trim().length > 0 || attachments.length > 0);

  // Suggestions follow the `/` token being typed; Escape hides them until the text changes.
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [dismissedFor, setDismissedFor] = React.useState<string | null>(null);
  const query = slashQuery(draft);
  const suggestions = React.useMemo(
    () => (query === null ? [] : filterSlashItems([...commands, ...skills], query)),
    [query, commands, skills],
  );
  const showSuggestions = !disabled && suggestions.length > 0 && dismissedFor !== draft;
  const active = Math.min(activeIndex, Math.max(suggestions.length - 1, 0));

  function pickItem(item: SlashItem) {
    setActiveIndex(0);
    if (item.kind === "command") {
      setDraft("");
      item.run();
    } else {
      setDraft(slashText(item));
    }
    focusComposer();
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const command = attachments.length === 0 ? findTypedCommand(commands, draft) : undefined;
    if (command) pickItem(command);
    else if (canSend) send(draft);
  }

  async function pick() {
    try {
      add(await bridge.files.pick());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
    focusComposer();
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

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (showSuggestions) {
      const count = suggestions.length;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((active + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
        return;
      }
      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
        const item = suggestions[active];
        // Enter on a command typed in full runs it; otherwise Enter and Tab pick the highlight.
        if (item) {
          event.preventDefault();
          pickItem(item);
          return;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissedFor(draft);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="relative mx-auto w-full max-w-3xl px-6 pb-6">
      {showSuggestions && (
        <SlashSuggestions
          items={suggestions}
          activeIndex={active}
          onHover={setActiveIndex}
          onPick={pickItem}
        />
      )}
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
          onChange={(event) => {
            setDraft(event.target.value);
            setActiveIndex(0);
          }}
          onPaste={(event) => void onPaste(event)}
          placeholder={
            disabled ? "Connect a model in Settings to start" : "Ask the agent, or type / for more"
          }
          aria-label="Message"
          aria-controls={showSuggestions ? "slash-suggestions" : undefined}
          aria-activedescendant={showSuggestions ? `slash-option-${active}` : undefined}
          className="min-h-14"
          disabled={disabled}
          onKeyDown={onKeyDown}
        />
        <InputGroupAddon align="block-end" className="gap-1 pt-1">
          <ComposerMenu
            bridge={bridge}
            disabled={disabled}
            commands={commands}
            skills={skills}
            onAttach={() => void pick()}
            onPick={pickItem}
          />
          <ModelPicker bridge={bridge} />
          <ThinkingPicker bridge={bridge} disabled={disabled} />
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
