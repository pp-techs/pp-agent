import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ChatMessage, ChatPart, ToolStatus } from "@workspace/shared";
import { splitAttachedFiles } from "./attachments.ts";

type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;
type UserMessage = Extract<AgentMessage, { role: "user" }>;
type ToolResultMessage = Extract<AgentMessage, { role: "toolResult" }>;

interface ToolState {
  messageId: string;
  status: ToolStatus;
  output?: string;
}

/** Tool output shown in the UI is capped; the model still receives the full result. */
const OUTPUT_LIMIT = 8_000;
/** Streaming updates are coalesced so a long reply does not flood IPC with one frame per token. */
const FLUSH_INTERVAL_MS = 50;

/**
 * Projects pi's agent messages into the renderer's chat model and emits upserts.
 * Assistant messages own their tool calls; tool status and output are folded into those parts.
 */
export class Transcript {
  private messages: ChatMessage[] = [];
  private readonly byId = new Map<string, ChatMessage>();
  private readonly tools = new Map<string, ToolState>();
  private readonly dirty = new Set<string>();
  private flushTimer: NodeJS.Timeout | null = null;
  /** Id of the assistant message currently streaming, set on message_start. */
  private currentAssistantId: string | null = null;
  private nextId = 0;
  /** Set while rebuilding a saved session; the caller sends one snapshot instead of upserts. */
  private loading = false;

  constructor(private readonly emit: (message: ChatMessage) => void) {}

  list(): ChatMessage[] {
    return this.messages;
  }

  reset(): void {
    this.cancelFlush();
    this.messages = [];
    this.byId.clear();
    this.tools.clear();
    this.dirty.clear();
    this.currentAssistantId = null;
  }

  addUser(message: UserMessage): void {
    const blocks =
      typeof message.content === "string"
        ? [{ type: "text" as const, text: message.content }]
        : message.content;
    const raw = blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const { text, files } = splitAttachedFiles(raw);
    const parts: ChatPart[] = [];
    if (text) parts.push({ type: "text", text });
    for (const file of files) parts.push({ type: "file", ...file });
    for (const block of blocks) {
      if (block.type === "image")
        parts.push({ type: "image", mimeType: block.mimeType, data: block.data });
    }
    this.upsert({ id: this.newId(), role: "user", parts }, true);
  }

  /** Rebuild the chat from a saved session's messages without emitting per-message updates. */
  load(messages: readonly AgentMessage[]): void {
    this.reset();
    this.loading = true;
    try {
      for (const message of messages) {
        if (message.role === "user") {
          this.addUser(message);
        } else if (message.role === "assistant") {
          this.startAssistant();
          this.updateAssistant(message, true);
        } else if (message.role === "toolResult") {
          this.finishTool(message.toolCallId, message.content, message.isError);
        }
      }
      // Calls without a saved result were cut off (app closed or run stopped mid-tool).
      for (const [toolCallId, state] of this.tools) {
        if (state.status === "running" || state.status === "awaiting-approval")
          this.setToolStatus(toolCallId, "error", "Interrupted before it finished.");
      }
    } finally {
      this.loading = false;
      this.dirty.clear();
    }
  }

  startAssistant(): void {
    this.currentAssistantId = this.newId();
  }

  updateAssistant(message: AssistantMessage, final: boolean): void {
    this.currentAssistantId ??= this.newId();
    const id = this.currentAssistantId;
    const chat: ChatMessage = { id, role: "assistant", parts: this.assistantParts(id, message) };
    if (final) {
      if (message.stopReason === "error")
        chat.error = message.errorMessage ?? "The model returned an error.";
      else if (message.stopReason === "aborted") chat.error = "Stopped.";
      this.currentAssistantId = null;
    }
    this.upsert(chat, final);
  }

  setToolStatus(toolCallId: string, status: ToolStatus, output?: string): void {
    const state = this.tools.get(toolCallId);
    if (!state) return;
    // A denial is final; the tool_execution_end that follows it must not turn it into an error.
    if (state.status === "denied") return;
    state.status = status;
    if (output !== undefined) state.output = truncate(output);
    this.refresh(state.messageId);
  }

  /** Called on tool_execution_end, which fires per tool as soon as it finishes (toolResult messages wait for the whole batch). */
  finishTool(toolCallId: string, content: ToolResultMessage["content"], isError: boolean): void {
    const output = content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    this.setToolStatus(toolCallId, isError ? "error" : "done", output);
  }

  /** Emit everything still buffered. */
  flush(): void {
    this.cancelFlush();
    if (!this.loading) {
      for (const id of this.dirty) {
        const message = this.byId.get(id);
        if (message) this.emit(message);
      }
    }
    this.dirty.clear();
  }

  private assistantParts(messageId: string, message: AssistantMessage): ChatPart[] {
    const parts: ChatPart[] = [];
    for (const block of message.content) {
      if (block.type === "text") {
        if (block.text) parts.push({ type: "text", text: block.text });
      } else if (block.type === "thinking") {
        if (!block.redacted && block.thinking.trim())
          parts.push({ type: "thinking", text: block.thinking });
      } else {
        let state = this.tools.get(block.id);
        if (!state) {
          state = { messageId, status: "running" };
          this.tools.set(block.id, state);
        }
        parts.push({
          type: "tool",
          toolCallId: block.id,
          name: block.name,
          args: block.arguments,
          status: state.status,
          output: state.output,
        });
      }
    }
    return parts;
  }

  /** Re-render a message after one of its tool parts changed. */
  private refresh(messageId: string): void {
    const message = this.byId.get(messageId);
    if (!message) return;
    const parts = message.parts.map((part) => {
      if (part.type !== "tool") return part;
      const state = this.tools.get(part.toolCallId);
      return state ? { ...part, status: state.status, output: state.output } : part;
    });
    this.upsert({ ...message, parts }, true);
  }

  private upsert(message: ChatMessage, immediate: boolean): void {
    const index = this.messages.findLastIndex((existing) => existing.id === message.id);
    if (index === -1) this.messages.push(message);
    else this.messages[index] = message;
    this.byId.set(message.id, message);
    this.dirty.add(message.id);
    if (immediate) this.flush();
    else this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  private cancelFlush(): void {
    clearTimeout(this.flushTimer ?? undefined);
    this.flushTimer = null;
  }

  private newId(): string {
    this.nextId += 1;
    return `m${this.nextId}`;
  }
}

function truncate(text: string): string {
  return text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}\n…` : text;
}
