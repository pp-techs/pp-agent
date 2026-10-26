import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { TelegramApiError } from "./api.ts";
import { MESSAGE_LIMIT } from "./format.ts";
import { EDIT_INTERVAL_MS, LiveMessage, TYPING_INTERVAL_MS } from "./live-message.ts";
import { FakeApi } from "./testing.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("LiveMessage", () => {
  test("sends on the first update, then edits at most once per interval with the latest text", async () => {
    const api = new FakeApi();
    const live = new LiveMessage(api, 5);
    live.update("a");
    await vi.advanceTimersByTimeAsync(0);
    expect(api.sent.map((m) => m.text)).toEqual(["a"]);

    live.update("ab");
    live.update("abc");
    live.update("abcd");
    await vi.advanceTimersByTimeAsync(EDIT_INTERVAL_MS - 1);
    expect(api.edits).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.edits.map((e) => e.text)).toEqual(["abcd"]);

    live.update("abcde");
    await vi.advanceTimersByTimeAsync(EDIT_INTERVAL_MS);
    expect(api.edits.map((e) => e.text)).toEqual(["abcd", "abcde"]);
    live.dispose();
  });

  test("finish flushes the exact final text without waiting", async () => {
    const api = new FakeApi();
    const live = new LiveMessage(api, 5);
    live.update("first");
    await vi.advanceTimersByTimeAsync(0);
    live.update("second");
    await live.finish("**final** answer");
    expect(api.edits.at(-1)?.text).toBe("<b>final</b> answer");
    expect(api.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.edits).toHaveLength(1);
  });

  test("rolls over into new messages and ends with every chunk exact", async () => {
    const api = new FakeApi();
    const live = new LiveMessage(api, 5);
    const lines = Array.from({ length: 700 }, (_, i) => `line number ${i}`);
    const text = lines.join("\n");
    live.update(lines.slice(0, 100).join("\n"));
    await vi.advanceTimersByTimeAsync(0);
    live.update(text);
    await vi.advanceTimersByTimeAsync(EDIT_INTERVAL_MS);
    await live.finish(text);
    expect(api.sent.length).toBeGreaterThan(1);
    const lastText = new Map<number, string>();
    for (const message of api.sent) lastText.set(message.id, message.text);
    for (const edit of api.edits) lastText.set(edit.messageId, edit.text);
    for (const part of lastText.values()) expect(part.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    const rebuilt = [...lastText.values()].join("\n");
    expect(rebuilt.replaceAll("\n", "")).toBe(text.replaceAll("\n", ""));
  });

  test("ignores 'message is not modified'", async () => {
    const api = new FakeApi();
    const live = new LiveMessage(api, 5);
    live.update("a");
    await vi.advanceTimersByTimeAsync(0);
    api.editError = () => new TelegramApiError("bad_request", "message is not modified", 400);
    await expect(live.finish("b")).resolves.toBeUndefined();
  });

  test("shows a tool status until text arrives, then replaces it", async () => {
    const api = new FakeApi();
    const live = new LiveMessage(api, 5);
    live.setStatus("Reading <report>.docx");
    await vi.advanceTimersByTimeAsync(0);
    expect(api.sent[0]?.text).toBe("<i>Reading &lt;report&gt;.docx</i>");
    live.update("Here it is");
    await vi.advanceTimersByTimeAsync(EDIT_INTERVAL_MS);
    expect(api.edits.at(-1)?.text).toBe("Here it is");
    live.setStatus("Another tool");
    await vi.advanceTimersByTimeAsync(EDIT_INTERVAL_MS * 2);
    expect(api.edits.at(-1)?.text).toBe("Here it is");
    live.dispose();
  });

  test("removes the status message when the turn ends without text", async () => {
    const api = new FakeApi();
    const live = new LiveMessage(api, 5);
    live.setStatus("Working");
    await vi.advanceTimersByTimeAsync(0);
    await live.finish("");
    expect(api.deleted).toEqual([api.sent[0]?.id]);
  });

  test("sends the typing action every 4 seconds until finished", async () => {
    const api = new FakeApi();
    const live = new LiveMessage(api, 5);
    live.start();
    expect(api.actions).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(TYPING_INTERVAL_MS * 2);
    expect(api.actions).toHaveLength(3);
    await live.finish("done");
    await vi.advanceTimersByTimeAsync(TYPING_INTERVAL_MS * 3);
    expect(api.actions).toHaveLength(3);
  });
});
