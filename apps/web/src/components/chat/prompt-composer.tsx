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
import { useQuery } from "@tanstack/react-query";
import { ArrowUpIcon, FileTextIcon, SquareIcon, XIcon } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ComposerMenu } from "@/components/chat/composer-menu";
import { GoalBanner } from "@/components/chat/goal-banner";
import { ModelPicker } from "@/components/chat/model-picker";
import { SlashSuggestions } from "@/components/chat/slash-suggestions";
import { ThinkingPicker } from "@/components/chat/thinking-picker";
import { VoiceControls } from "@/components/chat/voice-controls";
import { SettingsModal } from "@/components/modals/settings-modal";
import { useSendMessage } from "@/hooks/use-send-message";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import { voiceQuery } from "@/lib/extension-queries";
import { parseGoalCommand, type GoalParams } from "@/lib/goal";
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
import { insertTranscript } from "@/lib/voice-input";
import { QuestionCard } from "@/components/chat/question-card";
import { useChatStore } from "@/stores/chat-store";
import { toAttachments, useComposerStore } from "@/stores/composer-store";

export function PromptComposer({ bridge, disabled }: { bridge: DesktopBridge; disabled: boolean }) {
  // Like ChatGPT: one row while the text fits a line, then the text on top and the controls below.
  // Collapses again only once the draft is empty, so the wider layout can't flip back and forth.
  const [expanded, setExpanded] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);
  const running = useChatStore((state) => state.status === "running");
  /** The last send is not with the conversation yet; a second one would look like it never left. */
  const sending = useChatStore((state) => state.pending !== null);
  const draft = useComposerStore((state) => state.draft);
  const attachments = useComposerStore((state) => state.attachments);
  const { setDraft, add, remove } = useComposerStore.getState();
  const { abort, respondQuestion, setGoal } = useAgentCommands(bridge);
  // The agent's question takes the place of the composer until it is answered.
  const question = useChatStore((state) => Object.values(state.questions)[0]);
  const asking = question !== undefined;
  const send = useSendMessage(bridge);
  const { t } = useTranslation(["chat", "common"]);
  const { commands, skills } = useSlashItems(bridge);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const voice = useQuery(voiceQuery(bridge));

  /** Writes the transcript into the draft at the cursor; the person sends it when ready. */
  function insertText(text: string) {
    if (!text) return;
    const textarea = textareaRef.current;
    const current = useComposerStore.getState().draft;
    const start = textarea?.selectionStart ?? current.length;
    const result = insertTranscript(current, text, start, textarea?.selectionEnd ?? start);
    setDraft(result.draft);
    setExpanded((was) => was || result.draft.length > 60 || result.draft.includes("\n"));
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(result.caret, result.caret);
    });
  }

  const recorder = useVoiceRecorder(bridge, insertText);
  const canSend =
    !disabled && recorder.state === "idle" && (draft.trim().length > 0 || attachments.length > 0);

  /** Starts recording; when voice input is not set up, explains and opens its setting instead. */
  async function onMicrophone() {
    const view = voice.data ?? (await voice.refetch()).data;
    if (!view?.ready) {
      toast.info(t("composer.voice.notConfigured"));
      void SettingsModal.show({ bridge, section: "voice" });
      return;
    }
    void recorder.start();
  }

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

  const isExpanded = expanded && draft.length > 0;

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

  /** Runs `/goal …` typed in full; the draft comes back when it fails. */
  function runGoal(params: GoalParams) {
    const text = draft;
    setDraft("");
    setGoal.mutate(params, {
      onError: (error) => {
        // Keep what was typed while the command was pending.
        if (useComposerStore.getState().draft === "") setDraft(text);
        toast.error(error.message);
      },
    });
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const command = attachments.length === 0 ? findTypedCommand(commands, draft) : undefined;
    const goal = attachments.length === 0 ? parseGoalCommand(draft) : null;
    if (command) pickItem(command);
    else if (goal) {
      if (!disabled && !sending && !setGoal.isPending) runGoal(goal);
    } else if (canSend && !running && !sending) send(draft);
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

  // Hidden rather than removed, so the draft and attachments are still there after the answer.
  const wasAsking = React.useRef(false);
  React.useEffect(() => {
    if (wasAsking.current && !asking) textareaRef.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  return (
    <>
      {question && (
        <div className="mx-auto w-full max-w-3xl px-6 pb-6">
          <QuestionCard
            key={question.requestId}
            request={question}
            responding={respondQuestion.isPending}
            onRespond={(requestId, answers) =>
              respondQuestion.mutate(
                { requestId, answers },
                { onError: (error) => toast.error(error.message) },
              )
            }
          />
        </div>
      )}
      <GoalBanner bridge={bridge} />
      <form
        ref={formRef}
        onSubmit={onSubmit}
        hidden={asking}
        className="relative mx-auto w-full max-w-3xl px-6 pb-6"
      >
        {showSuggestions && (
          <SlashSuggestions
            items={suggestions}
            activeIndex={active}
            onHover={setActiveIndex}
            onPick={pickItem}
          />
        )}
        <InputGroup className="h-auto flex-col rounded-[28px] bg-muted/60 has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0 dark:bg-input/40">
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
                      aria-label={t("composer.removeAttachment", { name: attachment.name })}
                      onClick={() => remove(attachment.id)}
                    >
                      <XIcon />
                    </AttachmentAction>
                  </AttachmentActions>
                </Attachment>
              ))}
            </InputGroupAddon>
          )}
          <div className="@container flex w-full flex-wrap items-end gap-1 p-2">
            <ComposerMenu
              bridge={bridge}
              disabled={disabled}
              commands={commands}
              skills={skills}
              onAttach={() => void pick()}
              onPick={pickItem}
            />
            <InputGroupTextarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => {
                const { value, scrollHeight } = event.target;
                setDraft(value);
                setActiveIndex(0);
                setExpanded(
                  (was) => value.length > 0 && (was || value.includes("\n") || scrollHeight > 44),
                );
              }}
              onPaste={(event) => void onPaste(event)}
              placeholder={
                disabled ? t("composer.placeholderDisconnected") : t("composer.placeholder")
              }
              aria-label={t("composer.ariaLabel")}
              data-composer-input
              aria-controls={showSuggestions ? "slash-suggestions" : undefined}
              aria-activedescendant={showSuggestions ? `slash-option-${active}` : undefined}
              className={cn(
                "max-h-52 min-h-9 px-2 py-2 @max-2xl:order-first @max-2xl:basis-full @max-2xl:px-3",
                isExpanded && "order-first basis-full px-3",
              )}
              disabled={disabled}
              onKeyDown={onKeyDown}
            />
            <div className={cn("hidden flex-1 @max-2xl:block", isExpanded && "block")} />
            <ModelPicker bridge={bridge} />
            <ThinkingPicker bridge={bridge} disabled={disabled} />
            <VoiceControls
              state={recorder.state}
              startedAt={recorder.startedAt}
              disabled={disabled}
              onStart={() => void onMicrophone()}
              onStop={recorder.stop}
              onCancel={recorder.cancel}
            />
            {running ? (
              <InputGroupButton
                type="button"
                variant="default"
                size="icon-sm"
                className="size-9 rounded-full"
                aria-label={t("common:actions.stop")}
                onClick={() =>
                  abort.mutate(undefined, { onError: (error) => toast.error(error.message) })
                }
              >
                <SquareIcon className="fill-current" />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                type="submit"
                variant="default"
                size="icon-sm"
                disabled={!canSend || sending}
                className="size-9 rounded-full"
                aria-label={t("common:actions.send")}
              >
                <ArrowUpIcon />
              </InputGroupButton>
            )}
          </div>
        </InputGroup>
      </form>
    </>
  );
}
