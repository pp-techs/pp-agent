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
import { ComposerToken } from "@/components/chat/composer-token";
import { GoalBanner } from "@/components/chat/goal-banner";
import { HelperPanel } from "@/components/chat/helper-panel";
import { ResearchBanner } from "@/components/chat/research-banner";
import { ResearchToggle } from "@/components/chat/research-toggle";
import { InlineImage } from "@/components/chat/inline-image";
import { TodoPanel } from "@/components/chat/todo-panel";
import { ModelPicker } from "@/components/chat/model-picker";
import { SlashSuggestions } from "@/components/chat/slash-suggestions";
import { VoiceControls } from "@/components/chat/voice-controls";
import { SettingsModal } from "@/components/modals/settings-modal";
import { useSendMessage } from "@/hooks/use-send-message";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import { voiceQuery } from "@/lib/extension-queries";
import { parseGoalCommand, type GoalParams } from "@/lib/goal";
import {
  lastResearchDepth,
  parseResearchCommand,
  rememberResearchDepth,
  type ResearchStart,
} from "@/lib/research";
import {
  useAbort,
  useGoalPending,
  useResearchPending,
  useRespondQuestion,
  useSetGoal,
  useSetResearch,
} from "@/lib/queries";
import {
  filterSlashItems,
  findTypedCommand,
  focusComposer,
  leadingTokens,
  type SlashItem,
  slashQuery,
  slashText,
  tokensPrefix,
  useSlashItems,
} from "@/lib/slash-commands";
import { insertTranscript } from "@/lib/voice-input";
import { QuestionCard } from "@/components/chat/question-card";
import { useChatStore } from "@/stores/chat-store";
import { toAttachments, useComposerStore } from "@/stores/composer-store";
import { useWebSession } from "@/lib/web-bridge";

const MICROPHONE_AVAILABLE = window.isSecureContext && Boolean(navigator.mediaDevices);

export function PromptComposer({ bridge, disabled }: { bridge: DesktopBridge; disabled: boolean }) {
  // Always two rows: the text on top, the controls below.
  const formRef = React.useRef<HTMLFormElement>(null);
  const running = useChatStore((state) => state.status === "running");
  /** The last send is not with the conversation yet; a second one would look like it never left. */
  const sending = useChatStore((state) => state.pending !== null);
  /** The web app copies files to the computer first; a message sent now would leave them out. */
  const uploading = useWebSession((state) => state.uploads > 0);
  const draft = useComposerStore((state) => state.draft);
  const attachments = useComposerStore((state) => state.attachments);
  const { setDraft, add, remove } = useComposerStore.getState();
  const abort = useAbort(bridge);
  const respondQuestion = useRespondQuestion(bridge);
  const setGoal = useSetGoal(bridge);
  const goalPending = useGoalPending();
  const setResearch = useSetResearch(bridge);
  const researchPending = useResearchPending();
  const goal = useChatStore((state) => state.goal);
  const researchRun = useChatStore((state) => state.research);
  // The research switch: on with a chosen depth, or off (a normal message).
  const [researchMode, setResearchMode] = React.useState(() => ({
    on: false,
    depth: lastResearchDepth(),
  }));
  // The agent's question takes the place of the composer until it is answered.
  const question = useChatStore((state) => Object.values(state.questions)[0]);
  const asking = question !== undefined;
  const send = useSendMessage(bridge);
  const { t } = useTranslation(["chat", "common"]);
  const { commands, skills } = useSlashItems(bridge);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const voice = useQuery(voiceQuery(bridge));

  /** Writes the transcript into the draft at the cursor; the person sends it when ready. */
  function insertText(transcript: string) {
    if (!transcript) return;
    const textarea = textareaRef.current;
    const current = useComposerStore.getState().draft;
    // The textarea holds the draft without the chip's prefix; the transcript goes in the draft.
    const offset = textarea ? current.length - textarea.value.length : 0;
    const start = textarea ? textarea.selectionStart + offset : current.length;
    const end = textarea ? textarea.selectionEnd + offset : start;
    const result = insertTranscript(current, transcript, start, end);
    setDraft(result.draft);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(result.caret - offset, result.caret - offset);
    });
  }

  const recorder = useVoiceRecorder(bridge, insertText);
  const canSend =
    !disabled &&
    !uploading &&
    recorder.state === "idle" &&
    (draft.trim().length > 0 || attachments.length > 0);

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
  // The skills (or `/goal`) the message starts with are shown as chips; the textarea holds the rest.
  const { tokens, prefix } = leadingTokens(draft, skills);
  const text = draft.slice(prefix.length);
  const query = slashQuery(text);
  // Once a skill is picked, more skills can follow; a command would drop them.
  const suggestions = React.useMemo(() => {
    if (query === null) return [];
    const picked = new Set(tokens.map((token) => token.name));
    const items =
      tokens.length > 0
        ? skills.filter((item) => !picked.has(item.name))
        : [...commands, ...skills];
    return filterSlashItems(items, query);
  }, [query, tokens, commands, skills]);
  const showSuggestions = !disabled && suggestions.length > 0 && dismissedFor !== draft;
  const active = Math.min(activeIndex, Math.max(suggestions.length - 1, 0));

  function pickItem(item: SlashItem) {
    setActiveIndex(0);
    if (item.kind === "command") {
      setDraft("");
      item.run();
    } else {
      // The `/word` being typed becomes the chip; other text stays. A skill already picked is
      // not added twice.
      const kept = query === null ? text : "";
      const added = tokens.some((token) => token.kind === "skill" && token.name === item.name)
        ? ""
        : slashText(item);
      setDraft(prefix + added + kept);
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

  /** Starts a research run from the switch or `/research`; the draft comes back when it fails. */
  function runResearch(params: ResearchStart) {
    const text = draft;
    setDraft("");
    rememberResearchDepth(params.depth);
    setResearchMode({ on: false, depth: params.depth });
    setResearch.mutate(params, {
      onError: (error) => {
        if (useComposerStore.getState().draft === "") setDraft(text);
        toast.error(error.message);
      },
    });
  }

  /** Drops one chip; the others and the text after them stay. */
  function removeToken(index: number) {
    setDraft(tokensPrefix(tokens.filter((_, at) => at !== index)) + text);
    textareaRef.current?.focus();
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const command = attachments.length === 0 ? findTypedCommand(commands, draft) : undefined;
    const goal = attachments.length === 0 ? parseGoalCommand(draft) : null;
    const parsedResearch = attachments.length === 0 ? parseResearchCommand(draft) : null;
    if (command) pickItem(command);
    else if (goal) {
      if (!disabled && !sending && !goalPending) runGoal(goal);
    } else if (parsedResearch) {
      if (!disabled && !sending && !researchPending)
        runResearch({
          action: "start",
          question: parsedResearch.question,
          depth: parsedResearch.depth ?? researchMode.depth,
        });
    } else if (researchMode.on && draft.trim() && !running && !sending) {
      runResearch({ action: "start", question: draft.trim(), depth: researchMode.depth });
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
    const { selectionStart, selectionEnd } = event.currentTarget;
    if (
      tokens.length > 0 &&
      event.key === "Backspace" &&
      selectionStart === 0 &&
      selectionEnd === 0
    ) {
      event.preventDefault();
      removeToken(tokens.length - 1);
      return;
    }
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
        <div className="mx-auto w-full max-w-3xl px-3 pb-[max(var(--safe-bottom),0.75rem)] md:px-6 md:pb-6">
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
      <HelperPanel />
      <TodoPanel />
      <GoalBanner bridge={bridge} />
      <ResearchBanner bridge={bridge} />
      <form
        ref={formRef}
        onSubmit={onSubmit}
        hidden={asking}
        // A phone keeps the box clear of the home indicator, with narrower gutters.
        className="relative mx-auto w-full max-w-3xl px-3 pb-[max(var(--safe-bottom),0.75rem)] md:px-6 md:pb-6"
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
                      <InlineImage data={attachment.data} mimeType={attachment.mimeType} alt="" />
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
          <div className="flex w-full flex-wrap items-end gap-1 p-2">
            <ComposerMenu
              bridge={bridge}
              disabled={disabled}
              commands={commands}
              skills={skills}
              onAttach={() => void pick()}
              onPick={pickItem}
            />
            <ResearchToggle
              depth={researchMode.depth}
              on={researchMode.on}
              disabled={disabled || Boolean(goal) || Boolean(researchRun) || attachments.length > 0}
              onChange={setResearchMode}
            />
            {/* The first row: the skills (or `/goal`) the message starts with as chips, then the text. */}
            <div className="order-first flex basis-full flex-wrap items-start">
              {tokens.map((token, index) => (
                <ComposerToken
                  key={`${token.kind}:${token.name}`}
                  kind={token.kind}
                  name={token.name}
                  disabled={disabled}
                  onRemove={() => removeToken(index)}
                />
              ))}
              <InputGroupTextarea
                ref={textareaRef}
                value={text}
                onChange={(event) => {
                  setDraft(prefix + event.target.value);
                  setActiveIndex(0);
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
                  "max-h-52 min-h-9 py-2",
                  tokens.length > 0 ? "min-w-40 flex-1 px-2" : "min-w-0 px-3",
                )}
                disabled={disabled}
                onKeyDown={onKeyDown}
              />
            </div>
            {/* The model (with its thinking level) takes the room left on the controls row. */}
            <div className="flex min-w-0 flex-1 justify-end">
              <ModelPicker bridge={bridge} />
            </div>
            {/* Browsers allow the microphone only on secure pages; the web app on the local
                network is plain HTTP, so it has no voice input. */}
            {MICROPHONE_AVAILABLE && (
              <VoiceControls
                state={recorder.state}
                startedAt={recorder.startedAt}
                disabled={disabled}
                onStart={() => void onMicrophone()}
                onStop={recorder.stop}
                onCancel={recorder.cancel}
              />
            )}
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
