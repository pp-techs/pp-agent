import { describe, expect, test, vi } from "vite-plus/test";
import {
  classifySession,
  formatHistory,
  formatHistoryAround,
  formatSessions,
  historyLines,
  parseTimeBound,
  previewOf,
  rankSessionMatches,
  searchSessionHistory,
  selectSessions,
  sessionContextSection,
  sessionRef,
  type SessionRow,
} from "./session-index.ts";
import { createSessionsTool, type SessionsAccess } from "./sessions-tool.ts";
import { AGENT_TOOLS, helperTools, toolRule, toolTier } from "./tools.ts";
import type { AppSettings } from "@workspace/shared";

function row(patch: Partial<SessionRow> & { id: string }): SessionRow {
  return {
    title: patch.id,
    kind: "window",
    peer: null,
    workspaceId: "default",
    modified: 1_700_000_000_000,
    messageCount: 2,
    preview: "",
    isCurrent: false,
    ...patch,
  };
}

describe("session ids and kinds", () => {
  test("the id is the file name without its extension", () => {
    expect(sessionRef("/data/sessions/2026-10-27T10-00_abc.jsonl")).toBe("2026-10-27T10-00_abc");
  });

  test("a chat's file is a chat, a run's file is a task, the rest is the window", () => {
    const chats = new Map([["/s/chat.jsonl", "telegram:42"]]);
    const tasks = new Set(["/s/run.jsonl"]);
    expect(classifySession("/s/chat.jsonl", chats, tasks)).toEqual({
      kind: "chat",
      peer: "telegram:42",
    });
    expect(classifySession("/s/run.jsonl", chats, tasks)).toEqual({ kind: "task", peer: null });
    expect(classifySession("/s/other.jsonl", chats, tasks)).toEqual({
      kind: "window",
      peer: null,
    });
  });

  test("the preview is one short line of what the person typed", () => {
    expect(previewOf("  hello\n\nthere  ")).toBe("hello there");
    expect(previewOf("x".repeat(500))).toHaveLength(120);
  });
});

describe("what the agent may see", () => {
  const rows = [
    row({ id: "a", kind: "chat", peer: "telegram:1", title: "Weekly report", isCurrent: true }),
    row({ id: "b", kind: "task", title: "⏰ News", preview: "summarize the news" }),
    row({ id: "c", kind: "window", title: "Budget" }),
  ];

  test("`all` shows every session, `self` only the running one", () => {
    expect(selectSessions(rows, "all", {}).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(selectSessions(rows, "self", {}).map((r) => r.id)).toEqual(["a"]);
  });

  test("filters by kind, peer and words, and cuts to the limit", () => {
    expect(selectSessions(rows, "all", { kind: "task" }).map((r) => r.id)).toEqual(["b"]);
    expect(selectSessions(rows, "all", { peer: "telegram:1" }).map((r) => r.id)).toEqual(["a"]);
    expect(selectSessions(rows, "all", { search: "NEWS summarize" }).map((r) => r.id)).toEqual([
      "b",
    ]);
    expect(selectSessions(rows, "all", { limit: 2 })).toHaveLength(2);
  });

  test("the list marks the running session and names the chat", () => {
    const text = formatSessions(rows, "en");
    expect(text).toContain("id: a  (this session)");
    expect(text).toContain("kind: chat, telegram:1");
    expect(formatSessions([], "en")).toBe("No sessions.");
  });
});

describe("history", () => {
  test("keeps user and assistant text, drops tool traffic and empty messages", () => {
    const lines = historyLines([
      { role: "user", content: "hi", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "hello" }, { type: "toolCall" }] },
      { role: "toolResult", content: [{ type: "text", text: "secret output" }] },
      { role: "assistant", content: [{ type: "toolCall" }] },
      null,
    ]);
    expect(lines).toEqual([
      { role: "user", text: "hi", at: 1 },
      { role: "assistant", text: "hello", at: null },
    ]);
  });

  test("shows the last messages and says how many came before", () => {
    const lines = Array.from({ length: 5 }, (_, i) => ({
      role: "user" as const,
      text: `m${i}`,
      at: null,
    }));
    const text = formatHistory(lines, 2, "en");
    expect(text).toContain("(3 earlier messages not shown)");
    expect(text).toContain("m3");
    expect(text).toContain("m4");
    expect(text).not.toContain("m2");
    expect(formatHistory([], 5, "en")).toBe("This session has no messages.");
  });
});

describe("prompt section", () => {
  const base = {
    now: new Date("2026-10-27T11:03:00Z"),
    timeZone: "UTC",
    sessionId: "abc",
    kind: "chat" as const,
    surface: "a Telegram chat",
    home: "Telegram – Nhat",
    sessionsTool: true,
  };

  test("gives the date, the session and the person's own chat", () => {
    const text = sessionContextSection(base);
    expect(text).toContain("Tuesday, 2026-10-27");
    expect(text).toContain("time zone UTC");
    expect(text).toContain("a Telegram chat, session id abc");
    expect(text).toContain("The user's own chat is Telegram – Nhat");
    expect(text).toContain("sessions tool");
  });

  test("is the same all day, so the prompt stays cacheable", () => {
    const morning = sessionContextSection({ ...base, now: new Date("2026-10-27T01:00:00Z") });
    const evening = sessionContextSection({ ...base, now: new Date("2026-10-27T22:30:00Z") });
    expect(morning).toBe(evening);
  });

  test("handles no chat, no saved session and no tool", () => {
    const text = sessionContextSection({
      ...base,
      sessionId: null,
      home: null,
      sessionsTool: false,
    });
    expect(text).not.toContain("session id");
    expect(text).toContain("no chat channel paired");
    expect(text).not.toContain("sessions tool");
  });
});

describe("sessions tool", () => {
  const rows = [row({ id: "mine", isCurrent: true }), row({ id: "other", title: "Other" })];

  function tool(patch: Partial<SessionsAccess> = {}) {
    const history = vi.fn(async () => [{ role: "user" as const, text: "hello", at: null }]);
    const access: SessionsAccess = {
      list: async () => rows,
      history,
      currentId: () => "mine",
      peers: () => [],
      visibility: () => "all",
      locale: () => "en",
      ...patch,
    };
    const run = (params: Record<string, unknown>) =>
      createSessionsTool(access).execute(
        "call",
        params as never,
        undefined,
        undefined,
        undefined as never,
      );
    return { access, run, history };
  }

  const textOf = (result: Awaited<ReturnType<ReturnType<typeof tool>["run"]>>) =>
    result.content.map((block) => ("text" in block ? block.text : "")).join("");

  test("is a read tool that runs without asking, and the helper never gets it", () => {
    const settings = { toolPolicies: {}, shellEnabled: false } as unknown as AppSettings;
    expect(toolTier("sessions")).toBe("read");
    expect(toolRule("sessions", "read", settings).effective).toBe("allow");
    expect(AGENT_TOOLS).toContain("sessions");
    expect(helperTools(settings, null)).not.toContain("sessions");
  });

  test("lists sessions, or only its own where it is limited", async () => {
    expect(textOf(await tool().run({ action: "list" }))).toContain("id: other");
    const limited = textOf(await tool({ visibility: () => "self" }).run({ action: "list" }));
    expect(limited).toContain("id: mine");
    expect(limited).not.toContain("id: other");
    expect(limited).toContain("only see your own session");
  });

  test("reads the history of a listed session", async () => {
    const { run, history } = tool();
    expect(textOf(await run({ action: "history", sessionId: "other" }))).toContain("hello");
    expect(history).toHaveBeenCalledWith("other");
  });

  test("refuses an unknown id, and another session where it is limited", async () => {
    await expect(tool().run({ action: "history", sessionId: "nope" })).rejects.toThrow(
      /No session nope/,
    );
    await expect(
      tool({ visibility: () => "self" }).run({ action: "history", sessionId: "other" }),
    ).rejects.toThrow(/No session other/);
    // Its own session can always be read, even before the first message is saved.
    await expect(
      tool({ visibility: () => "self", list: async () => [] }).run({
        action: "history",
        sessionId: "mine",
      }),
    ).resolves.toBeDefined();
    await expect(tool().run({ action: "history" })).rejects.toThrow(/sessionId/);
  });

  test("shows where a message can be delivered", async () => {
    const withHome = tool({ peers: () => [{ id: "home", label: "Telegram", key: "telegram:42" }] });
    expect(textOf(await withHome.run({ action: "peers" }))).toContain("id: home");
    expect(textOf(await tool().run({ action: "peers" }))).toContain("nowhere to deliver");
  });

  test("full-text search finds matches across messages, demotes scheduled tasks, and supports scrolling", async () => {
    const now = 1_700_000_000_000;
    expect(parseTimeBound("7d", now)).toBe(now - 7 * 86_400_000);
    expect(parseTimeBound("24h", now)).toBe(now - 24 * 3_600_000);

    const taskRow = row({ id: "cron-1", kind: "task", title: "⏰ Daily", modified: now });
    const winRow = row({ id: "win-1", kind: "window", title: "Pricing", modified: now - 10_000 });
    const taskHit = searchSessionHistory(
      taskRow,
      [{ role: "assistant", text: "Báo giá hợp đồng A là 500 triệu", at: now }],
      "bao gia hop dong",
    );
    const winHit = searchSessionHistory(
      winRow,
      [
        { role: "user", text: "Xin chào", at: now - 20_000 },
        { role: "assistant", text: "Báo giá hợp đồng B là 300 triệu", at: now - 10_000 },
        { role: "user", text: "Chốt phương án này", at: now - 5_000 },
      ],
      "bao gia hop dong",
    );
    expect(taskHit).not.toBeNull();
    expect(winHit).not.toBeNull();
    const ranked = rankSessionMatches([taskHit!, winHit!], 10);
    expect(ranked.map((m) => m.session.id)).toEqual(["win-1", "cron-1"]);

    const scrolled = formatHistoryAround(
      Array.from({ length: 10 }, (_, i) => ({ role: "user" as const, text: `msg-${i}`, at: null })),
      5,
      3,
      "en",
    );
    expect(scrolled).toContain("[#5 * user]");
    expect(scrolled).toContain("earlier messages not shown");
    expect(scrolled).toContain("later messages not shown");

    const { run } = tool({
      list: async () => [taskRow, winRow],
      history: async (id) =>
        id === "win-1"
          ? [
              { role: "user", text: "Xin chào", at: now - 20_000 },
              { role: "assistant", text: "Báo giá hợp đồng B là 300 triệu", at: now - 10_000 },
            ]
          : [{ role: "assistant", text: "Báo giá hợp đồng A là 500 triệu", at: now }],
    });
    const searchOut = textOf(await run({ action: "search", query: "bao gia" }));
    expect(searchOut.indexOf("win-1")).toBeLessThan(searchOut.indexOf("cron-1"));
    expect(searchOut).toContain("around=1");

    const scrollOut = textOf(
      await run({ action: "history", sessionId: "win-1", around: 1, limit: 2 }),
    );
    expect(scrollOut).toContain("[#1 * assistant");
    expect(scrollOut).toContain("300 triệu");
  });
});
