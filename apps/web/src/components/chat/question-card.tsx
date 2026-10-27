import * as React from "react";
import type { Question, QuestionAnswer, QuestionRequest } from "@workspace/shared";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Item, ItemContent, ItemMedia } from "@workspace/ui/components/item";
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group";
import { MessageCircleQuestionIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Longest text the person may type for "Other"; the same limit the agent enforces. */
const MAX_CUSTOM_LENGTH = 2000;
const OTHER = "other";

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

function QuestionField({
  idPrefix,
  question,
  draft,
  disabled,
  onChange,
}: {
  idPrefix: string;
  question: Question;
  draft: Draft;
  disabled: boolean;
  onChange: (draft: Draft) => void;
}) {
  const { t } = useTranslation("chat");
  const optionId = (key: string | number) => `${idPrefix}-${key}`;
  const description = (index: number) => {
    const text = question.options[index]!.description;
    return text ? <FieldDescription>{text}</FieldDescription> : null;
  };
  const recommended = (index: number) =>
    question.recommended === index ? (
      <Badge variant="secondary">{t("toolStep.ask.recommended")}</Badge>
    ) : null;

  const otherField = (
    <Input
      aria-label={t("toolStep.ask.otherLabel")}
      placeholder={t("toolStep.ask.otherPlaceholder")}
      value={draft.custom}
      maxLength={MAX_CUSTOM_LENGTH}
      disabled={disabled}
      autoComplete="off"
      autoFocus
      onChange={(event) => onChange({ ...draft, custom: event.target.value })}
    />
  );

  return (
    <FieldSet className="gap-2">
      <FieldLegend variant="label" className="mb-0">
        {question.question}
      </FieldLegend>
      {question.multi ? (
        <div role="group" aria-label={question.question} className="flex flex-col gap-2">
          {question.options.map((option, index) => (
            <Field key={index} orientation="horizontal">
              <Checkbox
                id={optionId(index)}
                checked={draft.picked.includes(index)}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  onChange({
                    ...draft,
                    picked: checked
                      ? [...draft.picked, index]
                      : draft.picked.filter((picked) => picked !== index),
                  })
                }
              />
              <FieldContent>
                <FieldLabel htmlFor={optionId(index)}>
                  {option.label}
                  {recommended(index)}
                </FieldLabel>
                {description(index)}
              </FieldContent>
            </Field>
          ))}
          <Field orientation="horizontal">
            <Checkbox
              id={optionId(OTHER)}
              checked={draft.other}
              disabled={disabled}
              onCheckedChange={(checked) => onChange({ ...draft, other: checked })}
            />
            <FieldContent>
              <FieldLabel htmlFor={optionId(OTHER)}>{t("toolStep.ask.other")}</FieldLabel>
            </FieldContent>
          </Field>
        </div>
      ) : (
        <RadioGroup
          aria-label={question.question}
          className="gap-2"
          value={draft.other ? OTHER : draft.picked[0] === undefined ? "" : String(draft.picked[0])}
          disabled={disabled}
          onValueChange={(value) => {
            if (typeof value !== "string") return;
            onChange(
              value === OTHER
                ? { ...draft, picked: [], other: true }
                : { ...draft, picked: [Number(value)], other: false },
            );
          }}
        >
          {question.options.map((option, index) => (
            <Field key={index} orientation="horizontal">
              <RadioGroupItem value={String(index)} id={optionId(index)} />
              <FieldContent>
                <FieldLabel htmlFor={optionId(index)}>
                  {option.label}
                  {recommended(index)}
                </FieldLabel>
                {description(index)}
              </FieldContent>
            </Field>
          ))}
          <Field orientation="horizontal">
            <RadioGroupItem value={OTHER} id={optionId(OTHER)} />
            <FieldContent>
              <FieldLabel htmlFor={optionId(OTHER)}>{t("toolStep.ask.other")}</FieldLabel>
            </FieldContent>
          </Field>
        </RadioGroup>
      )}
      {draft.other && otherField}
    </FieldSet>
  );
}

/** The agent's questions (`ask_user`): options to pick, or a text of the person's own. */
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
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({});
  const draftOf = (question: Question) => drafts[question.id] ?? EMPTY;
  const ready = request.questions.every((question) => isAnswered(draftOf(question)));

  return (
    <Item
      variant="outline"
      size="sm"
      className="w-full"
      role="group"
      aria-label={t("toolStep.ask.title")}
    >
      <ItemMedia variant="icon">
        <MessageCircleQuestionIcon />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-4">
        {request.questions.map((question) => (
          <QuestionField
            key={question.id}
            idPrefix={`ask-${request.requestId}-${question.id}`}
            question={question}
            draft={draftOf(question)}
            disabled={responding}
            onChange={(draft) => setDrafts((current) => ({ ...current, [question.id]: draft }))}
          />
        ))}
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={responding}
            onClick={() => onRespond(request.requestId, null)}
          >
            {t("toolStep.ask.skip")}
          </Button>
          <Button
            size="sm"
            disabled={responding || !ready}
            onClick={() =>
              onRespond(
                request.requestId,
                request.questions.map((question) => toAnswer(question, draftOf(question))),
              )
            }
          >
            {t("toolStep.ask.send")}
          </Button>
        </div>
      </ItemContent>
    </Item>
  );
}
