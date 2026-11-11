import type { AgentSnapshot, ChatMessage } from "@workspace/shared";
import { beforeEach, expect, it } from "vite-plus/test";

import { useChatStore } from "./chat-store";

const message = (
  id: string,
  text: string,
  role: ChatMessage["role"] = "assistant",
): ChatMessage => ({
  id,
  role,
  parts: [{ type: "text", text }],
});

function snapshot(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    status: "idle",
    messages: [],
    approvals: [],
    questions: [],
    model: null,
    agent: null,
    thinking: { level: "off", available: [] },
    workspace: null,
    workspaceDir: null,
    sessionPath: "/chats/a.jsonl",
    temporary: false,
    context: null,
    activity: { running: [], waiting: [] },
    yolo: { active: false, source: "conversation" },
    goal: null,
    research: null,
    ...overrides,
  };
}

beforeEach(() => {
  useChatStore.setState({ messages: [], pending: null, sessionPath: null, echoKeys: {} });
});

it("keeps the messages, and the message being sent, on a snapshot of settings", () => {
  const { apply } = useChatStore.getState();
  const kept = [message("m1", "hi", "user"), message("m2", "hello")];
  apply({ type: "snapshot", snapshot: snapshot({ messages: kept }) });
  const pending = message("p1", "next", "user");
  useChatStore.getState().setPending(pending);

  apply({
    type: "snapshot",
    snapshot: snapshot({ messages: [], messagesUnchanged: true, status: "running" }),
  });

  const state = useChatStore.getState();
  expect(state.messages).toEqual(kept);
  expect(state.pending).toBe(pending);
  expect(state.status).toBe("running");
});

it("keeps the messages of a full snapshot that did not change as the same objects", () => {
  const { apply } = useChatStore.getState();
  apply({ type: "snapshot", snapshot: snapshot({ messages: [message("m1", "hi")] }) });
  const before = useChatStore.getState().messages;
  apply({ type: "snapshot", snapshot: snapshot({ messages: [message("m1", "hi")] }) });
  expect(useChatStore.getState().messages).toBe(before);
});

it("adds streamed text to the message it belongs to", () => {
  const { apply } = useChatStore.getState();
  apply({ type: "snapshot", snapshot: snapshot({ messages: [message("m1", "Hel")] }) });
  apply({ type: "message_append", id: "m1", index: 0, offset: 3, text: "lo" });
  expect(useChatStore.getState().messages[0]?.parts[0]).toEqual({ type: "text", text: "Hello" });
});
