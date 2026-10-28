import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  assistantText,
  CHAT_IDLE_MS,
  channelTitle,
  ChatSessionMap,
  chatAgentId,
  idleChats,
  KeyedQueue,
  turnResult,
} from "./channel-sessions.ts";

function reply(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop",
  errorMessage?: string,
): AssistantMessage {
  return {
    role: "assistant",
    content,
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
  } as AssistantMessage;
}

describe("channelTitle", () => {
  it("names the channel and the date", () => {
    const title = channelTitle("Telegram", new Date(2026, 2, 4, 9, 30), "en");
    expect(title.startsWith("💬 Telegram – ")).toBe(true);
    expect(title).toContain("2026");
  });
});

describe("ChatSessionMap", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chat-map-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("persists mappings for the next start, privately", () => {
    const file = join(dir, "nested", "channels.json");
    const map = new ChatSessionMap(file);
    map.set("telegram:1", "/sessions/a.jsonl");
    map.set("telegram:2", "/sessions/b.jsonl");
    const again = new ChatSessionMap(file);
    expect(again.get("telegram:1")).toBe("/sessions/a.jsonl");
    expect(again.get("telegram:2")).toBe("/sessions/b.jsonl");
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("archives the current chat on /new and keeps the others", () => {
    const file = join(dir, "channels.json");
    const map = new ChatSessionMap(file);
    map.set("telegram:1", "/a");
    map.set("telegram:2", "/b");
    expect(map.drop("telegram:1")).toBe(true);
    expect(map.drop("telegram:1")).toBe(false);
    const again = new ChatSessionMap(file);
    expect(again.get("telegram:1")).toBeUndefined();
    expect(again.get("telegram:2")).toBe("/b");
    expect(again.history("telegram:1")).toEqual(["/a"]);
    expect(again.entries()).toEqual([["telegram:2", "/b"]]);
    expect(again.resume("telegram:1", "/a")).toBe(true);
    expect(again.get("telegram:1")).toBe("/a");
    expect(again.history("telegram:1")).toEqual([]);
    expect(new ChatSessionMap(file).get("telegram:1")).toBe("/a");
  });

  it("retains reset history after restart and a fresh turn without empty or duplicate files", () => {
    const file = join(dir, "channels.json");
    const map = new ChatSessionMap(file);
    map.set("telegram:1", "/a");
    map.set("telegram:1", "/b");
    map.drop("telegram:1");
    const again = new ChatSessionMap(file);
    expect(again.get("telegram:1")).toBeUndefined();
    expect(again.history("telegram:1")).toEqual(["/b", "/a"]);
    expect(again.entries()).toEqual([]);
    again.set("telegram:1", "/c");
    expect(again.history("telegram:1")).toEqual(["/b", "/a"]);
    expect(again.resume("telegram:1", "/a")).toBe(true);
    expect(again.history("telegram:1")).toEqual(["/c", "/b"]);
    again.set("telegram:1", "/b");
    expect(again.history("telegram:1")).toEqual(["/a", "/c"]);
    expect(new ChatSessionMap(file).history("telegram:1")).toEqual(["/a", "/c"]);
  });

  it("caps archived history at twenty sessions through repeated resets", () => {
    const file = join(dir, "channels.json");
    const map = new ChatSessionMap(file);
    for (let i = 0; i < 25; i++) {
      map.set("telegram:1", `/${i}`);
      map.drop("telegram:1");
    }
    expect(new ChatSessionMap(file).history("telegram:1")).toEqual(
      Array.from({ length: 20 }, (_, i) => `/${24 - i}`),
    );
  });

  it("leaves no temporary file behind", () => {
    const file = join(dir, "channels.json");
    new ChatSessionMap(file).set("telegram:1", "/a");
    expect(new ChatSessionMap(file).get("telegram:1")).toBe("/a");
    expect(() => statSync(`${file}.tmp`)).toThrow();
  });

  it("starts empty from a damaged or odd file", () => {
    const file = join(dir, "channels.json");
    writeFileSync(file, "{not json");
    expect(new ChatSessionMap(file).get("telegram:1")).toBeUndefined();
    writeFileSync(file, JSON.stringify({ chats: { ok: "/x", bad: 3, empty: "" } }));
    const map = new ChatSessionMap(file);
    expect(map.get("ok")).toBe("/x");
    expect(map.get("bad")).toBeUndefined();
    expect(map.get("empty")).toBeUndefined();
  });
});

describe("KeyedQueue", () => {
  it("runs one key's tasks in order and other keys concurrently", async () => {
    const queue = new KeyedQueue();
    const log: string[] = [];
    const gate = Promise.withResolvers<void>();
    const first = queue.run("a", async () => {
      log.push("a1 start");
      await gate.promise;
      log.push("a1 end");
    });
    const second = queue.run("a", async () => {
      log.push("a2");
    });
    const other = queue.run("b", async () => {
      log.push("b");
    });
    await other;
    expect(log).toEqual(["a1 start", "b"]);
    expect(queue.busy("a")).toBe(true);
    gate.resolve();
    await Promise.all([first, second]);
    expect(log).toEqual(["a1 start", "b", "a1 end", "a2"]);
  });

  it("keeps going after a task fails and forgets idle keys", async () => {
    const queue = new KeyedQueue();
    const failed = queue.run("a", async () => {
      throw new Error("boom");
    });
    const next = queue.run("a", async () => "ok");
    await expect(failed).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
    await vi.waitFor(() => expect(queue.busy("a")).toBe(false));
  });
});

describe("idleChats", () => {
  const now = 10 * CHAT_IDLE_MS;
  it("lists chats unused for the idle time that are not busy", () => {
    const lastUsed = new Map([
      ["old", now - CHAT_IDLE_MS],
      ["older-busy", now - 2 * CHAT_IDLE_MS],
      ["recent", now - CHAT_IDLE_MS + 1],
    ]);
    expect(idleChats(lastUsed, (key) => key === "older-busy", now)).toEqual(["old"]);
  });
});

describe("turnResult", () => {
  const fallbacks = { failed: "failed", noAnswer: "no answer" };

  it("reads the text of the last reply", () => {
    const message = reply([
      { type: "thinking", thinking: "hmm" },
      { type: "text", text: " Hello " },
      { type: "text", text: "there" },
    ] as AssistantMessage["content"]);
    expect(assistantText(message)).toBe("Hello there");
    expect(turnResult(message, false, fallbacks)).toEqual({ text: "Hello there", status: "done" });
  });

  it("reports an error reply with its message, else the fallback", () => {
    expect(turnResult(reply([], "error", "rate limited"), false, fallbacks)).toEqual({
      text: "",
      status: "error",
      error: "rate limited",
    });
    expect(turnResult(reply([], "error"), false, fallbacks).error).toBe("failed");
  });

  it("reports aborted and missing replies", () => {
    expect(turnResult(reply([], "aborted"), false, fallbacks).status).toBe("aborted");
    expect(turnResult(undefined, true, fallbacks).status).toBe("aborted");
    expect(turnResult(undefined, false, fallbacks)).toEqual({
      text: "",
      status: "error",
      error: "no answer",
    });
  });
});

describe("ChatSessionMap choices", () => {
  it("keeps a chat's agent and workspace across /new and restarts", () => {
    const dir = mkdtempSync(join(tmpdir(), "chat-choice-"));
    try {
      const file = join(dir, "channels.json");
      const map = new ChatSessionMap(file);
      map.set("telegram:1", "/a");
      map.setChoice("telegram:1", { agentId: "agent-x" });
      map.setChoice("telegram:1", { workspaceId: "ws-y" });
      map.drop("telegram:1");
      const again = new ChatSessionMap(file);
      expect(again.get("telegram:1")).toBeUndefined();
      expect(again.choice("telegram:1")).toEqual({ agentId: "agent-x", workspaceId: "ws-y" });
      expect(again.choice("telegram:2")).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chatAgentId", () => {
  const exists = (id: string) => ["a", "b", "c"].includes(id);

  it("prefers the chat's pick, then the channel's pin, then the workspace's agent", () => {
    expect(chatAgentId(["a", "b", "c"], exists, "default")).toBe("a");
    expect(chatAgentId([undefined, "b", "c"], exists, "default")).toBe("b");
    expect(chatAgentId([undefined, null, "c"], exists, "default")).toBe("c");
  });

  it("skips agents that were deleted and falls back to the built-in one", () => {
    expect(chatAgentId(["gone", null, "c"], exists, "default")).toBe("c");
    expect(chatAgentId(["gone", "also-gone", null], exists, "default")).toBe("default");
  });
});
