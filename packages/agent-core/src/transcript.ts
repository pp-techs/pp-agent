import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  AgentEvent,
  ChatMessage,
  ChatPart,
  HelperProgress,
  ToolStatus,
} from "@workspace/shared";
import { splitAttachedFiles } from "./attachments.ts";
import { parseSkillBlocks } from "./skill-chain.ts";
import { t } from "./i18n.ts";
import { modelErrorDetail, modelErrorText } from "./model-error.ts";

type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;
type UserMessage = Extract<AgentMessage, { role: "user" }>;
type ToolResultMessage = Extract<AgentMessage, { role: "toolResult" }>;

interface ToolState {
  messageId: string;
  status: ToolStatus;
  output?: string;
  /** Sub agent status of `delegate_task`, while it runs. */
  helpers?: HelperProgress[];
}

/** The `message_append` event: what a streamed reply added since the last update that went out. */
export type MessageAppend = Extract<AgentEvent, { type: "message_append" }>;

export type TranscriptItem = AgentMessage | { role: "compaction" };

/** One item of a saved conversation with the id of its session entry (compactions have none). */
export interface TranscriptEntry {
  item: TranscriptItem;
  entryId?: string;
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

  /** Each message as it last went out, to send only what a streamed reply added since. */
  private readonly sent = new Map<string, ChatMessage>();

  /**
   * `emit` sends a whole message. With `emitAppend`, a streamed update that only added text to the
   * end of the last part goes out through it instead, as just the added text.
   */
  constructor(
    private readonly emit: (message: ChatMessage) => void,
    private readonly emitAppend?: (append: MessageAppend) => void,
  ) {}

  list(): ChatMessage[] {
    return this.messages;
  }

  reset(): void {
    this.cancelFlush();
    this.messages = [];
    this.byId.clear();
    this.sent.clear();
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
    // `/skill:<name> args` reaches the model expanded; show it as the skills plus the person's text.
    const skills = parseSkillBlocks(raw);
    const { text, files } = splitAttachedFiles(skills ? (skills.userMessage ?? "") : raw);
    const parts: ChatPart[] = [];
    for (const name of skills?.names ?? []) parts.push({ type: "skill", name });
    if (text) parts.push({ type: "text", text });
    for (const file of files) parts.push({ type: "file", ...file });
    for (const block of blocks) {
      if (block.type === "image")
        parts.push({ type: "image", mimeType: block.mimeType, data: block.data });
    }
    this.upsert({ id: this.newId(), role: "user", parts }, true);
  }

  /** Rebuild the chat from a saved session's messages without emitting per-message updates. */
  load(entries: readonly TranscriptEntry[]): void {
    this.reset();
    this.loading = true;
    try {
      for (const { item: message, entryId } of entries) {
        if (message.role === "compaction") {
          this.addCompaction();
        } else if (message.role === "user") {
          this.addUser(message);
          this.tag(entryId);
        } else if (message.role === "assistant") {
          this.startAssistant();
          this.updateAssistant(message, true);
          this.tag(entryId);
        } else if (message.role === "toolResult") {
          this.finishTool(message.toolCallId, message.content, message.isError);
        }
      }
      // Calls without a saved result were cut off (app closed or run stopped mid-tool).
      for (const [toolCallId, state] of this.tools) {
        if (
          state.status === "running" ||
          state.status === "awaiting-approval" ||
          state.status === "awaiting-answer"
        )
          this.setToolStatus(toolCallId, "error", t("conversations.interrupted"));
      }
    } finally {
      this.loading = false;
      this.dirty.clear();
    }
  }

  /**
   * Gives the chat's user and assistant messages the ids of their session entries, in order. Called
   * once a run settles, when the entries of the new messages exist; changes go out with `flush`.
   */
  setEntryIds(entryIds: readonly string[]): void {
    let next = 0;
    for (const message of this.messages) {
      if (message.role === "compaction") continue;
      const entryId = entryIds[next];
      next += 1;
      if (entryId === undefined || message.entryId === entryId) continue;
      message.entryId = entryId;
      this.dirty.add(message.id);
    }
  }

  /** Records the session entry of the message just added. */
  private tag(entryId: string | undefined): void {
    const message = this.messages.at(-1);
    if (message && entryId !== undefined) message.entryId = entryId;
  }

  /** Marks where the model's view of the chat was summarized; the messages above stay visible. */
  addCompaction(): void {
    this.upsert({ id: this.newId(), role: "compaction", parts: [] }, true);
  }

  startAssistant(): void {
    this.currentAssistantId = this.newId();
  }

  updateAssistant(message: AssistantMessage, final: boolean): void {
    this.currentAssistantId ??= this.newId();
    const id = this.currentAssistantId;
    const chat: ChatMessage = { id, role: "assistant", parts: this.assistantParts(id, message) };
    if (final) {
      if (message.stopReason === "error") {
        chat.error = modelErrorText(message.errorMessage);
        chat.errorDetail = modelErrorDetail(message);
      } else if (message.stopReason === "aborted") chat.error = t("conversations.stopped");
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

  /** Replaces the live sub agent status of a running `delegate_task` call. */
  setToolHelpers(toolCallId: string, helpers: HelperProgress[]): void {
    const state = this.tools.get(toolCallId);
    if (!state) return;
    state.helpers = helpers;
    this.refresh(state.messageId);
  }

  /** Called on tool_execution_end, which fires per tool as soon as it finishes (toolResult messages wait for the whole batch). */
  finishTool(toolCallId: string, content: ToolResultMessage["content"], isError: boolean): void {
    const output = content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    // The summary replaces the progress; a running tool is the only place it is shown.
    const state = this.tools.get(toolCallId);
    if (state) state.helpers = undefined;
    this.setToolStatus(toolCallId, isError ? "error" : "done", output);
  }

  /** Emit everything still buffered. */
  flush(): void {
    this.cancelFlush();
    if (!this.loading) {
      for (const id of this.dirty) {
        const message = this.byId.get(id);
        if (message) this.send(message);
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
          helpers: state.helpers,
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
      return state
        ? { ...part, status: state.status, output: state.output, helpers: state.helpers }
        : part;
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

  /** Sends `message`: whole, or as the text a streamed reply added, or not at all if it is as it was. */
  private send(message: ChatMessage): void {
    const before = this.sent.get(message.id);
    this.sent.set(message.id, message);
    const append = before ? appendedText(before, message) : undefined;
    if (append === null) return;
    if (append && this.emitAppend) this.emitAppend(append);
    else this.emit(message);
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

/** Whether two parts are the same message content (reference equality for anything but text). */
function samePart(a: ChatPart, b: ChatPart): boolean {
  if (a === b) return true;
  if (a.type !== b.type) return false;
  if (a.type === "text" || a.type === "thinking") return a.text === (b as typeof a).text;
  if (a.type === "tool") {
    const other = b as typeof a;
    return (
      a.toolCallId === other.toolCallId &&
      a.name === other.name &&
      a.args === other.args &&
      a.status === other.status &&
      a.output === other.output &&
      a.helpers === other.helpers
    );
  }
  return false;
}

/**
 * What `after` adds to `before`, when all it adds is text at the end of its last part: the
 * `message_append` to send in place of the whole message. `null` when nothing differs (it need not
 * be sent again), `undefined` when more than that changed.
 */
function appendedText(before: ChatMessage, after: ChatMessage): MessageAppend | null | undefined {
  if (
    before.role !== after.role ||
    before.error !== after.error ||
    before.errorDetail !== after.errorDetail ||
    before.entryId !== after.entryId ||
    before.parts.length !== after.parts.length
  )
    return undefined;
  const last = after.parts.length - 1;
  for (let index = 0; index < last; index += 1) {
    const [old, current] = [before.parts[index], after.parts[index]];
    if (!old || !current || !samePart(old, current)) return undefined;
  }
  const [old, current] = [before.parts[last], after.parts[last]];
  if (!old || !current) return before.parts.length === 0 ? null : undefined;
  if (samePart(old, current)) return null;
  if (
    (old.type !== "text" && old.type !== "thinking") ||
    old.type !== current.type ||
    !current.text.startsWith(old.text)
  )
    return undefined;
  return {
    type: "message_append",
    id: after.id,
    index: last,
    offset: old.text.length,
    text: current.text.slice(old.text.length),
  };
}

function truncate(text: string): string {
  return text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}\n…` : text;
}
