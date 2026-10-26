import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { APPROVAL_TIMEOUT_MS, TelegramApprovals } from "./approvals.ts";
import { approvalRequest, FakeApi, fakeT } from "./testing.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function tap(data: string, from: number) {
  return { id: "cb1", from: { id: from, first_name: "X" }, data };
}

describe("TelegramApprovals", () => {
  test("asks with an Approve/Deny keyboard and resolves with the owner's tap", async () => {
    const api = new FakeApi();
    const approvals = new TelegramApprovals(api, fakeT);
    const answer = approvals.ask(5, approvalRequest("r1"));
    await vi.advanceTimersByTimeAsync(0);
    const keyboard = api.sent[0]?.options?.replyMarkup?.inline_keyboard[0];
    expect(keyboard?.map((button) => button.callback_data)).toEqual(["ap:r1:1", "ap:r1:0"]);
    expect(api.sent[0]?.text).toContain("rm -rf &lt;tmp&gt;");

    expect(await approvals.handleCallback(tap("ap:r1:1", 7), 7)).toBe(true);
    await expect(answer).resolves.toBe(true);
    expect(api.edits[0]?.text).toContain("channels.telegram.approved");
    expect(api.edits[0]?.options?.replyMarkup).toEqual({ inline_keyboard: [] });
    expect(api.answers).toHaveLength(1);
  });

  test("a deny tap resolves false", async () => {
    const api = new FakeApi();
    const approvals = new TelegramApprovals(api, fakeT);
    const answer = approvals.ask(5, approvalRequest("r1"));
    await vi.advanceTimersByTimeAsync(0);
    await approvals.handleCallback(tap("ap:r1:0", 7), 7);
    await expect(answer).resolves.toBe(false);
    expect(api.edits[0]?.text).toContain("channels.telegram.denied");
  });

  test("a tap from anyone else changes nothing", async () => {
    const api = new FakeApi();
    const approvals = new TelegramApprovals(api, fakeT);
    let settled = false;
    void approvals.ask(5, approvalRequest("r1")).then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(await approvals.handleCallback(tap("ap:r1:1", 99), 7)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    expect(api.edits).toHaveLength(0);
  });

  test("denies and marks the message expired after ten minutes", async () => {
    const api = new FakeApi();
    const approvals = new TelegramApprovals(api, fakeT);
    const answer = approvals.ask(5, approvalRequest("r1"));
    await vi.advanceTimersByTimeAsync(APPROVAL_TIMEOUT_MS);
    await expect(answer).resolves.toBe(false);
    expect(api.edits[0]?.text).toContain("channels.telegram.expired");
    // A late tap finds nothing to approve.
    await approvals.handleCallback(tap("ap:r1:1", 7), 7);
    expect(api.answers.at(-1)?.text).toBe("channels.telegram.expired");
  });

  test("ignores callbacks that are not approvals, and denyAll settles a chat's questions", async () => {
    const api = new FakeApi();
    const approvals = new TelegramApprovals(api, fakeT);
    expect(await approvals.handleCallback(tap("other", 7), 7)).toBe(false);
    const answer = approvals.ask(5, approvalRequest("r1"));
    await vi.advanceTimersByTimeAsync(0);
    approvals.denyAll(6);
    approvals.denyAll(5);
    await expect(answer).resolves.toBe(false);
  });

  test("denies when the question cannot be sent", async () => {
    const api = new FakeApi();
    api.sendError = () => new Error("offline");
    const approvals = new TelegramApprovals(api, fakeT);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(approvals.ask(5, approvalRequest())).resolves.toBe(false);
  });
});
