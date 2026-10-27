import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { QUESTION_TIMEOUT_MS, TelegramQuestions } from "./questions.ts";
import { FakeApi, fakeT, questionRequest } from "./testing.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function tap(data: string, from = 7) {
  return { id: "cb1", from: { id: from, first_name: "X" }, data };
}

function buttons(api: FakeApi, sentIndex: number) {
  return (api.sent[sentIndex]?.options?.replyMarkup?.inline_keyboard ?? []).flat();
}

describe("TelegramQuestions", () => {
  test("asks one question at a time and answers a single-select with one tap", async () => {
    const api = new FakeApi();
    const questions = new TelegramQuestions(api, fakeT);
    const answers = questions.ask(5, questionRequest());
    await vi.advanceTimersByTimeAsync(0);

    expect(api.sent).toHaveLength(1);
    expect(api.sent[0]?.text).toContain("Which &lt;period&gt;?");
    expect(api.sent[0]?.text).toContain("July to September");
    expect(buttons(api, 0).map((button) => button.callback_data)).toEqual([
      "q:q1:0:0",
      "q:q1:0:1",
      "q:q1:0:2",
      "q:q1:0:o",
      "q:q1:0:s",
    ]);
    expect(buttons(api, 0)[1]?.text).toContain("questionRecommended");

    await questions.handleCallback(tap("q:q1:0:1"), 7);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.edits[0]?.text).toContain("✅ Q4");
    expect(api.edits[0]?.options?.replyMarkup).toEqual({ inline_keyboard: [] });
    // The second question is sent only after the first is answered.
    expect(api.sent).toHaveLength(2);
    expect(api.sent[1]?.text).toContain("Which formats?");

    await questions.handleCallback(tap("q:q1:1:0"), 7);
    await questions.handleCallback(tap("q:q1:1:1"), 7);
    await questions.handleCallback(tap("q:q1:1:0"), 7);
    await questions.handleCallback(tap("q:q1:1:d"), 7);
    await expect(answers).resolves.toEqual([
      { id: "scope", selected: ["Q4"] },
      { id: "formats", selected: ["Excel"] },
    ]);
  });

  test("a multi-select toggles marks and needs at least one option before Done", async () => {
    const api = new FakeApi();
    const questions = new TelegramQuestions(api, fakeT);
    const request = questionRequest();
    const answers = questions.ask(5, { ...request, questions: [request.questions[1]!] });
    await vi.advanceTimersByTimeAsync(0);
    expect(buttons(api, 0).map((button) => button.text)).toContain("☐ PDF");

    await questions.handleCallback(tap("q:q1:0:d"), 7);
    expect(api.answers.at(-1)?.text).toBe("channels.telegram.questionPickOne");
    expect(api.edits).toHaveLength(0);

    await questions.handleCallback(tap("q:q1:0:0"), 7);
    const toggled = api.edits[0]?.options?.replyMarkup?.inline_keyboard.flat();
    expect(toggled?.[0]?.text).toBe("☑ PDF");
    expect(api.edits[0]?.text).toBe(api.sent[0]?.text);

    await questions.handleCallback(tap("q:q1:0:d"), 7);
    await expect(answers).resolves.toEqual([{ id: "formats", selected: ["PDF"] }]);
  });

  test("Other takes the owner's next text, together with the options already ticked", async () => {
    const api = new FakeApi();
    const questions = new TelegramQuestions(api, fakeT);
    const request = questionRequest();
    const answers = questions.ask(5, { ...request, questions: [request.questions[1]!] });
    await vi.advanceTimersByTimeAsync(0);

    expect(questions.handleText(5, "ignored")).toBe(false);
    await questions.handleCallback(tap("q:q1:0:1"), 7);
    await questions.handleCallback(tap("q:q1:0:o"), 7);
    expect(api.plainTexts).toContain("channels.telegram.questionTypeAnswer");

    expect(questions.handleText(9, "other chat")).toBe(false);
    // Blank text is taken but does not answer, so it cannot queue behind the waiting turn.
    const edits = api.edits.length;
    expect(questions.handleText(5, "   ")).toBe(true);
    expect(api.edits).toHaveLength(edits);
    expect(questions.handleText(5, " as a CSV ")).toBe(true);
    await expect(answers).resolves.toEqual([
      { id: "formats", selected: ["Excel"], custom: "as a CSV" },
    ]);
    expect(api.edits.at(-1)?.text).toContain("questionOtherAnswer");
    // Answered: the next text is an ordinary message again.
    expect(questions.handleText(5, "again")).toBe(false);
  });

  test("tapping an option after Other goes back to the options", async () => {
    const api = new FakeApi();
    const questions = new TelegramQuestions(api, fakeT);
    const answers = questions.ask(5, questionRequest());
    await vi.advanceTimersByTimeAsync(0);
    await questions.handleCallback(tap("q:q1:0:o"), 7);
    await questions.handleCallback(tap("q:q1:0:2"), 7);
    await vi.advanceTimersByTimeAsync(0);
    expect(questions.handleText(5, "late")).toBe(false);
    await questions.handleCallback(tap("q:q1:1:0"), 7);
    await questions.handleCallback(tap("q:q1:1:d"), 7);
    await expect(answers).resolves.toEqual([
      { id: "scope", selected: ["Year"] },
      { id: "formats", selected: ["PDF"] },
    ]);
  });

  test("Skip ends the whole request with null", async () => {
    const api = new FakeApi();
    const questions = new TelegramQuestions(api, fakeT);
    const answers = questions.ask(5, questionRequest());
    await vi.advanceTimersByTimeAsync(0);
    await questions.handleCallback(tap("q:q1:0:s"), 7);
    await expect(answers).resolves.toBeNull();
    expect(api.edits[0]?.text).toContain("questionSkipped");
    expect(api.sent).toHaveLength(1);
  });

  test("a tap from anyone else, or on a stale question, changes nothing", async () => {
    const api = new FakeApi();
    const questions = new TelegramQuestions(api, fakeT);
    const answers = questions.ask(5, questionRequest());
    await vi.advanceTimersByTimeAsync(0);

    expect(await questions.handleCallback(tap("q:q1:0:0", 99), 7)).toBe(true);
    expect(await questions.handleCallback(tap("q:q1:0:0"), null)).toBe(true);
    // The second question's buttons are not live yet.
    expect(await questions.handleCallback(tap("q:q1:1:0"), 7)).toBe(true);
    expect(api.edits).toHaveLength(0);
    expect(api.answers.at(-1)?.text).toBe("channels.telegram.questionExpired");

    expect(await questions.handleCallback(tap("ap:q1:1"), 7)).toBe(false);
    questions.skipAll();
    await expect(answers).resolves.toBeNull();
  });

  test("a question nobody answers is skipped after ten minutes", async () => {
    const api = new FakeApi();
    const questions = new TelegramQuestions(api, fakeT);
    const answers = questions.ask(5, questionRequest());
    await vi.advanceTimersByTimeAsync(QUESTION_TIMEOUT_MS);
    await expect(answers).resolves.toBeNull();
    expect(api.edits[0]?.text).toContain("questionExpired");
  });

  test("skipAll(chatId) skips only that chat's questions", async () => {
    const api = new FakeApi();
    const questions = new TelegramQuestions(api, fakeT);
    const mine = questions.ask(5, questionRequest("a"));
    const theirs = questions.ask(6, questionRequest("b"));
    await vi.advanceTimersByTimeAsync(0);
    questions.skipAll(5);
    await expect(mine).resolves.toBeNull();
    await questions.handleCallback(tap("q:b:0:0"), 7);
    await vi.advanceTimersByTimeAsync(0);
    await questions.handleCallback(tap("q:b:1:0"), 7);
    await questions.handleCallback(tap("q:b:1:d"), 7);
    await expect(theirs).resolves.toEqual([
      { id: "scope", selected: ["Q3"] },
      { id: "formats", selected: ["PDF"] },
    ]);
  });

  test("a message that cannot be sent skips the question", async () => {
    const api = new FakeApi();
    api.sendError = () => new Error("down");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const questions = new TelegramQuestions(api, fakeT);
    await expect(questions.ask(5, questionRequest())).resolves.toBeNull();
  });

  test("callback data stays within Telegram's 64 bytes for a real request id", async () => {
    const api = new FakeApi();
    const questions = new TelegramQuestions(api, fakeT);
    const id = "123e4567-e89b-12d3-a456-426614174000";
    void questions.ask(5, questionRequest(id));
    await vi.advanceTimersByTimeAsync(0);
    for (const button of buttons(api, 0))
      expect(new TextEncoder().encode(button.callback_data).length).toBeLessThanOrEqual(64);
    questions.skipAll();
  });
});
