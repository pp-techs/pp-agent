import * as React from "react";
import type { Question, QuestionAnswer, QuestionRequest } from "@workspace/shared";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, PencilIcon, XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Longest text the person may type for "Other"; the same limit the agent enforces. */
const MAX_CUSTOM_LENGTH = 2000;
/** Pause before a pick moves on, so the pick is seen first. */
const ADVANCE_DELAY_MS = 220;

interface Draft {
  /** Positions of the options picked. */
  picked: number[];
  other: boolean;
  custom: string;
}

const EMPTY: Draft = { picked: [], other: false, custom: "" };

function isAnswered(draft: Draft): boolean {
  return draft.picked.length > 0 || (draft.other && draft.custom.trim() !== "");
}

function toAnswer(question: Question, draft: Draft): QuestionAnswer {
  const custom = draft.other ? draft.custom.trim() : "";
  return {
    id: question.id,
    selected: draft.picked.toSorted((a, b) => a - b).map((index) => question.options[index]!.label),
    ...(custom ? { custom } : {}),
  };
}

/**
 * The agent's questions (`ask_user`), asked one at a time: numbered options to pick, or a text of
 * the person's own. A single-choice pick moves on by itself, and the last answer sends everything.
 * Keys: 1-9 pick, arrows move, Enter picks, Esc skips.
 */
export function QuestionCard({
  request,
  onRespond,
  responding,
}: {
  request: QuestionRequest;
  onRespond: (requestId: string, answers: QuestionAnswer[] | null) => void;
  responding: boolean;
}) {
  const { t } = useTranslation("chat");
  const questions = request.questions;
  const total = questions.length;
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({});
  const [step, setStep] = React.useState(0);
  const [cursor, setCursor] = React.useState(questions[0]?.recommended ?? 0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const pending = React.useRef(false);

  const question = questions[step]!;
  const count = question.options.length;
  const isLast = step === total - 1;
  const draft = drafts[question.id] ?? EMPTY;
  const busy = responding;

  React.useEffect(() => {
    rootRef.current?.focus();
  }, [step]);

  function goTo(index: number) {
    setStep(index);
    setCursor(questions[index]?.recommended ?? 0);
  }

  function update(next: Draft) {
    setDrafts((current) => ({ ...current, [question.id]: next }));
  }

  /** Moves past this question: on to the next, back to one left open, or sends the lot. */
  function proceed(all: Record<string, Draft>) {
    if (pending.current) return;
    pending.current = true;
    setTimeout(() => {
      pending.current = false;
      const open = questions.findIndex((item) => !isAnswered(all[item.id] ?? EMPTY));
      if (isLast && open === -1) {
        onRespond(
          request.requestId,
          questions.map((item) => toAnswer(item, all[item.id] ?? EMPTY)),
        );
      } else if (!isLast) {
        goTo(step + 1);
      } else {
        goTo(open);
      }
    }, ADVANCE_DELAY_MS);
  }

  function pick(index: number) {
    if (busy || pending.current) return;
    setCursor(index);
    if (question.multi) {
      update({
        ...draft,
        picked: draft.picked.includes(index)
          ? draft.picked.filter((picked) => picked !== index)
          : [...draft.picked, index],
      });
      return;
    }
    const next = { ...draft, picked: [index], other: false };
    update(next);
    proceed({ ...drafts, [question.id]: next });
  }

  function onCustom(custom: string) {
    const typed = custom.trim() !== "";
    update({
      ...draft,
      custom,
      other: typed,
      picked: question.multi || !typed ? draft.picked : [],
    });
  }

  function skip() {
    if (!busy) onRespond(request.requestId, null);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (busy || event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      skip();
      return;
    }
    if (event.target instanceof HTMLInputElement) {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        rootRef.current?.focus();
        setCursor(count - 1);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (cursor >= count - 1) {
        setCursor(count);
        inputRef.current?.focus();
      } else {
        setCursor(cursor + 1);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor(Math.max(0, cursor - 1));
    } else if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      if (cursor < count) pick(cursor);
    } else if (/^[1-9]$/.test(event.key) && Number(event.key) <= count) {
      event.preventDefault();
      pick(Number(event.key) - 1);
    }
  }

  const idPrefix = `ask-${request.requestId}-${question.id}`;

  return (
    <div className="w-full">
      <div
        ref={rootRef}
        tabIndex={-1}
        role="group"
        aria-label={t("toolStep.ask.title")}
        onKeyDown={onKeyDown}
        className="flex w-full flex-col gap-2 rounded-[28px] border border-input bg-muted/60 p-2 outline-hidden dark:bg-input/40"
      >
        <div className="flex items-start justify-between gap-3 px-3 pt-3">
          <h3 id={`${idPrefix}-title`} className="text-base leading-snug font-medium">
            {question.question}
          </h3>
          <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
            {total > 1 && (
              <div className="flex items-center gap-0.5 text-sm tabular-nums">
                <Button
                  size="icon-xs"
                  variant="ghost"
                  disabled={busy || step === 0}
                  aria-label={t("toolStep.ask.back")}
                  onClick={() => goTo(step - 1)}
                >
                  <ChevronLeftIcon />
                </Button>
                <span>{t("toolStep.ask.step", { current: step + 1, total })}</span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  disabled={busy || isLast || !isAnswered(draft)}
                  aria-label={t("toolStep.ask.next")}
                  onClick={() => goTo(step + 1)}
                >
                  <ChevronRightIcon />
                </Button>
              </div>
            )}
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={busy}
              aria-label={t("toolStep.ask.skip")}
              onClick={skip}
            >
              <XIcon />
            </Button>
          </div>
        </div>

        <div
          role={question.multi ? "group" : "radiogroup"}
          aria-labelledby={`${idPrefix}-title`}
          className="flex flex-col px-2"
        >
          {question.options.map((option, index) => {
            const selected = draft.picked.includes(index);
            return (
              <button
                key={index}
                type="button"
                role={question.multi ? "checkbox" : "radio"}
                aria-checked={selected}
                disabled={busy}
                tabIndex={-1}
                onClick={() => pick(index)}
                onMouseEnter={() => setCursor(index)}
                className={cn(
                  "flex w-full items-start gap-3 border-b border-border px-2 py-3 text-left transition-colors last:border-b-0 disabled:opacity-50",
                  cursor === index && "bg-foreground/5",
                )}
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-xl text-sm tabular-nums transition-colors",
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground",
                  )}
                >
                  {selected ? <CheckIcon className="size-4" /> : index + 1}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    {option.label}
                    {question.recommended === index && (
                      <Badge variant="secondary">{t("toolStep.ask.recommended")}</Badge>
                    )}
                  </span>
                  {option.description && (
                    <span className="text-sm text-muted-foreground">{option.description}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <div
          className={cn(
            "flex items-center gap-3 rounded-3xl bg-background/60 p-1.5 pr-2 transition-colors",
            "border border-transparent focus-within:border-ring",
            cursor === count && "bg-background",
          )}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
            <PencilIcon className="size-3.5" />
          </span>
          <Input
            ref={inputRef}
            aria-label={t("toolStep.ask.otherLabel")}
            placeholder={t("toolStep.ask.otherPlaceholder")}
            value={draft.custom}
            maxLength={MAX_CUSTOM_LENGTH}
            disabled={busy}
            autoComplete="off"
            className="h-8 flex-1 border-0 bg-transparent px-1 caret-primary shadow-none focus-visible:ring-0 dark:bg-transparent"
            onFocus={() => setCursor(count)}
            onChange={(event) => onCustom(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              if (isAnswered(draft)) proceed(drafts);
            }}
          />
          <Button size="sm" disabled={busy || !isAnswered(draft)} onClick={() => proceed(drafts)}>
            {isLast ? t("toolStep.ask.send") : t("toolStep.ask.next")}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={skip}>
            {t("toolStep.ask.skip")}
          </Button>
        </div>
      </div>
      <p className="mt-2 hidden text-center text-xs text-muted-foreground md:block">
        {t("toolStep.ask.hint")}
      </p>
    </div>
  );
}
