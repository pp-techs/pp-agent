/**
 * `ask_user`: the model asks the person one or more multiple-choice questions and waits for the
 * answers. The person may pick options or type an answer of their own ("Other", added by the app,
 * never by the model). It needs nobody's approval; the question is the interaction. Sessions with
 * nobody to ask (scheduled runs, helpers) do not get the tool. The window and Telegram each decide
 * how a question is shown, through `AskUser`.
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { Question, QuestionAnswer } from "@workspace/shared";
import { Type } from "typebox";

export const ASK_TOOL = "ask_user";

export const ASK_LIMITS = {
  maxQuestions: 5,
  minOptions: 2,
  maxOptions: 6,
  maxIdLength: 40,
  maxQuestionLength: 300,
  maxLabelLength: 80,
  maxDescriptionLength: 200,
  /** Longest answer typed for "Other". */
  maxCustomLength: 2000,
} as const;

/** What the host does with a call: show the questions and resolve with the answers (null: skipped). */
export type AskUser = (
  call: { toolCallId: string; questions: Question[] },
  signal?: AbortSignal,
) => Promise<QuestionAnswer[] | null>;

/** Labels the model may not use: the app adds its own field for the person's answer. */
const RESERVED_LABELS = ["other", "other (type your own)"];

const parameters = Type.Object({
  questions: Type.Array(
    Type.Object({
      id: Type.String({
        minLength: 1,
        maxLength: ASK_LIMITS.maxIdLength,
        description: "Short name for this question, unique in the call (for example `scope`)",
      }),
      question: Type.String({
        minLength: 1,
        maxLength: ASK_LIMITS.maxQuestionLength,
        description: "The question, in plain language",
      }),
      options: Type.Array(
        Type.Object({
          label: Type.String({
            minLength: 1,
            maxLength: ASK_LIMITS.maxLabelLength,
            description: "Short choice, unique within the question",
          }),
          description: Type.Optional(
            Type.String({
              maxLength: ASK_LIMITS.maxDescriptionLength,
              description: "One line on what the choice means or costs",
            }),
          ),
        }),
        {
          minItems: ASK_LIMITS.minOptions,
          maxItems: ASK_LIMITS.maxOptions,
          description: `${ASK_LIMITS.minOptions} to ${ASK_LIMITS.maxOptions} choices. Do not add an "Other" choice; the app adds one.`,
        },
      ),
      multi: Type.Optional(
        Type.Boolean({ description: "Allow picking more than one choice. Default false." }),
      ),
      recommended: Type.Optional(
        Type.Integer({
          minimum: 0,
          description: "Position (from 0) of the choice you suggest",
        }),
      ),
    }),
    {
      minItems: 1,
      maxItems: ASK_LIMITS.maxQuestions,
      description: "Related questions, asked together",
    },
  ),
});

/** Trims the model's text and drops a suggestion that points at no option. */
export function normalizeQuestions(questions: readonly Question[]): Question[] {
  return questions.map((question) => {
    const options = question.options.map((option) => {
      const description = option.description?.trim();
      return { label: option.label.trim(), ...(description ? { description } : {}) };
    });
    const { recommended } = question;
    return {
      id: question.id.trim(),
      question: question.question.trim(),
      options,
      ...(question.multi === true ? { multi: true } : {}),
      ...(recommended !== undefined && Number.isInteger(recommended) && recommended < options.length
        ? { recommended }
        : {}),
    };
  });
}

/** What is wrong with the questions the model sent, in words the model can act on; null when fine. */
export function checkQuestions(questions: readonly Question[]): string | null {
  if (questions.length === 0) return "Send at least one question.";
  if (questions.length > ASK_LIMITS.maxQuestions)
    return `Ask at most ${ASK_LIMITS.maxQuestions} questions at once.`;
  const ids = new Set<string>();
  for (const question of questions) {
    if (question.id === "" || question.question === "")
      return "Every question needs an id and a question text.";
    if (ids.has(question.id)) return `The question id "${question.id}" is used twice.`;
    ids.add(question.id);
    if (question.options.length < ASK_LIMITS.minOptions)
      return `Question "${question.id}" needs at least ${ASK_LIMITS.minOptions} options.`;
    if (question.options.length > ASK_LIMITS.maxOptions)
      return `Question "${question.id}" has more than ${ASK_LIMITS.maxOptions} options.`;
    const labels = new Set<string>();
    for (const { label } of question.options) {
      const key = label.toLowerCase();
      if (label === "") return `Question "${question.id}" has an empty option.`;
      if (RESERVED_LABELS.includes(key))
        return `Question "${question.id}": do not add an "Other" option; the app adds one.`;
      if (labels.has(key)) return `Question "${question.id}" lists "${label}" twice.`;
      labels.add(key);
    }
  }
  return null;
}

/**
 * Checks answers that came from a person against the questions and puts them in question order.
 * Throws when an answer does not fit, so the card stays open and the person can fix it.
 */
export function checkAnswers(
  questions: readonly Question[],
  answers: readonly QuestionAnswer[],
): QuestionAnswer[] {
  return questions.map((question) => {
    const answer = answers.find((candidate) => candidate.id === question.id);
    if (!answer) throw new Error(`Answer the question "${question.question}".`);
    const labels = question.options.map((option) => option.label);
    const selected = [...new Set(answer.selected)];
    if (!selected.every((label) => labels.includes(label)))
      throw new Error(`An answer to "${question.question}" is not one of the options.`);
    const custom = typeof answer.custom === "string" ? answer.custom.trim() : "";
    if (custom.length > ASK_LIMITS.maxCustomLength)
      throw new Error(`The answer to "${question.question}" is too long.`);
    const count = selected.length + (custom ? 1 : 0);
    if (count === 0) throw new Error(`Answer the question "${question.question}".`);
    if (question.multi !== true && count > 1)
      throw new Error(`Pick one answer for "${question.question}".`);
    return { id: question.id, selected, ...(custom ? { custom } : {}) };
  });
}

function answerText(answer: QuestionAnswer | undefined): string {
  if (!answer) return "(no answer)";
  const parts = [...answer.selected];
  if (answer.custom) parts.push(`Other: ${answer.custom}`);
  return parts.length > 0 ? parts.join(", ") : "(no answer)";
}

/** The result the model reads. */
export function formatAnswers(
  questions: readonly Question[],
  answers: readonly QuestionAnswer[],
): string {
  const find = (id: string) => answers.find((answer) => answer.id === id);
  const [only] = questions;
  if (questions.length === 1 && only) return `User answered: ${answerText(find(only.id))}`;
  return [
    "User answers:",
    ...questions.map((question) => `- ${question.id}: ${answerText(find(question.id))}`),
  ].join("\n");
}

export function createAskTool(askUser: AskUser) {
  return defineTool({
    name: ASK_TOOL,
    label: "Ask the user",
    description:
      "Asks the user one or more multiple-choice questions and waits for the answers. " +
      'The user can also type an answer of their own, so never add an "Other" option. ' +
      "Use it only when the choices lead to materially different results and the files, notes and conversation do not settle it.",
    promptSnippet: "Ask the user to choose between options before going on",
    parameters,
    prepareArguments: (args) => {
      if (!args || typeof args !== "object" || Array.isArray(args)) return args as never;
      const raw = { ...(args as Record<string, unknown>) };
      if (typeof raw.questions === "string") {
        try {
          raw.questions = JSON.parse(raw.questions);
        } catch {}
      }
      return raw as never;
    },
    // One question card at a time.
    executionMode: "sequential",
    async execute(toolCallId, params, signal) {
      const questions = normalizeQuestions(params.questions);
      const problem = checkQuestions(questions);
      if (problem) throw new Error(problem);
      const answers = await askUser({ toolCallId, questions }, signal);
      if (!answers) throw new Error("The user chose not to answer.");
      return {
        content: [{ type: "text", text: formatAnswers(questions, answers) }],
        details: undefined,
      };
    },
  });
}

/** Prompt guidance while `ask_user` is active; null when it is not. */
export function askSection(active: readonly string[]): string | null {
  if (!active.includes(ASK_TOOL)) return null;
  return [
    "## Asking the user",
    "- Use ask_user only when the choices lead to materially different results and the files, notes and conversation do not settle them. Otherwise pick the standard option, carry on, and say what you chose.",
    '- Put related questions in one call. Give each 2 to 6 short options and put the trade-off in the description. Set recommended to the option you suggest. Never add an "Other" option: the person can always type their own answer, which then arrives as "Other: ...".',
    "- If the person chose not to answer, carry on with your best judgment or stop and say what you need.",
  ].join("\n");
}
