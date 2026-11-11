import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ChatMessage } from "@workspace/shared";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { type MessageAppend, Transcript } from "./transcript.ts";

type Assistant = Extract<AgentMessage, { role: "assistant" }>;

const reply = (...content: unknown[]) =>
  ({ role: "assistant", content, stopReason: "stop" }) as unknown as Assistant;
const text = (value: string) => ({ type: "text", text: value });

type Sent = { whole: ChatMessage } | { append: MessageAppend };

function setup() {
  const sent: Sent[] = [];
  const transcript = new Transcript(
    (whole) => sent.push({ whole }),
    (append) => sent.push({ append }),
  );
  return { sent, transcript };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Transcript streaming", () => {
  test("sends a streamed reply whole once, then only the text it adds", () => {
    const { sent, transcript } = setup();
    transcript.startAssistant();
    transcript.updateAssistant(reply(text("Hello")), false);
    vi.advanceTimersByTime(60);
    transcript.updateAssistant(reply(text("Hello, wor")), false);
    vi.advanceTimersByTime(60);
    transcript.updateAssistant(reply(text("Hello, world")), false);
    vi.advanceTimersByTime(60);

    expect(sent).toHaveLength(3);
    expect(sent[0]).toMatchObject({ whole: { parts: [{ type: "text", text: "Hello" }] } });
    expect(sent[1]).toEqual({
      append: { type: "message_append", id: "m1", index: 0, offset: 5, text: ", wor" },
    });
    expect(sent[2]).toEqual({
      append: { type: "message_append", id: "m1", index: 0, offset: 10, text: "ld" },
    });
  });

  test("applying the sent updates in order gives the message the transcript holds", () => {
    const { sent, transcript } = setup();
    transcript.startAssistant();
    let written = "";
    for (const piece of ["Once ", "upon ", "a ", "time"]) {
      written += piece;
      transcript.updateAssistant(reply(text(written)), false);
      vi.advanceTimersByTime(60);
    }
    let shown = "";
    for (const entry of sent) {
      if ("whole" in entry) shown = (entry.whole.parts[0] as { text: string }).text;
      else shown = shown.slice(0, entry.append.offset) + entry.append.text;
    }
    expect(shown).toBe("Once upon a time");
  });

  test("sends the whole message when more than the end of the last part changed", () => {
    const { sent, transcript } = setup();
    transcript.startAssistant();
    transcript.updateAssistant(reply(text("Hello")), false);
    vi.advanceTimersByTime(60);
    // A tool call starts after the text: a new part.
    transcript.updateAssistant(
      reply(text("Hello"), { type: "toolCall", id: "c1", name: "read", arguments: {} }),
      false,
    );
    vi.advanceTimersByTime(60);
    // The text was rewritten, not extended.
    transcript.updateAssistant(reply(text("Jello")), false);
    vi.advanceTimersByTime(60);
    expect(sent.every((entry) => "whole" in entry)).toBe(true);
    expect(sent).toHaveLength(3);
  });

  test("the final update, with its error, goes out whole", () => {
    const { sent, transcript } = setup();
    transcript.startAssistant();
    transcript.updateAssistant(reply(text("Partial")), false);
    vi.advanceTimersByTime(60);
    transcript.updateAssistant(
      { ...reply(text("Partial text")), stopReason: "error", errorMessage: "boom" } as Assistant,
      true,
    );
    const last = sent.at(-1);
    expect(last).toMatchObject({ whole: { error: expect.any(String) } });
  });

  test("does not send a message again when it is as it was sent", () => {
    const { sent, transcript } = setup();
    transcript.startAssistant();
    transcript.updateAssistant(reply(text("Done")), false);
    vi.advanceTimersByTime(60);
    transcript.updateAssistant(reply(text("Done")), true);
    expect(sent).toHaveLength(1);
  });

  test("without an append listener every update goes out whole", () => {
    const sent: ChatMessage[] = [];
    const transcript = new Transcript((message) => sent.push(message));
    transcript.startAssistant();
    transcript.updateAssistant(reply(text("a")), false);
    vi.advanceTimersByTime(60);
    transcript.updateAssistant(reply(text("ab")), false);
    vi.advanceTimersByTime(60);
    expect(sent.map((message) => message.parts[0])).toEqual([
      { type: "text", text: "a" },
      { type: "text", text: "ab" },
    ]);
  });
  test("sends the saved entry id of a message once the run settles, though its text did not change", () => {
    const { sent, transcript } = setup();
    transcript.startAssistant();
    transcript.updateAssistant(reply(text("Done")), false);
    vi.advanceTimersByTime(60);
    transcript.updateAssistant(reply(text("Done")), true);
    expect(sent).toHaveLength(1);

    transcript.setEntryIds(["entry-1"]);
    transcript.flush();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ whole: { id: "m1", entryId: "entry-1" } });
  });
});
