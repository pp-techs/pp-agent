import type { Attachment, ChannelState } from "@workspace/shared";
import type { ChannelGateway, ChannelInput, ChatOption, TurnResult } from "../types.ts";
import { findOption } from "../shared/options.ts";
import type { PairingGuard } from "../shared/pairing.ts";
import { abortableSleep } from "../shared/sleep.ts";
import { splitText } from "../shared/split.ts";
import {
  MAX_DOWNLOAD_BYTES,
  ZaloApiError,
  HttpZaloApi,
  type ZaloApi,
  type ZaloMessage,
  type ZaloUpdate,
  type ZaloUser,
} from "./api.ts";
import { ZaloPrompts } from "./prompts.ts";
import type { ZaloTextName, ZaloTranslate } from "./text.ts";

/** Zalo refuses messages longer than 2000 characters. */
export const MESSAGE_LIMIT = 2000;
/** Messages that may wait behind the turn in progress, per chat. */
export const MAX_QUEUED_MESSAGES = 5;
const MAX_BACKOFF_MS = 30_000;
/** A poll that returns this fast with nothing in it is not holding the connection open. */
const MIN_POLL_MS = 1000;
const TYPING_INTERVAL_MS = 5000;
/** Most options one list shows. */
const MAX_CHOICES = 30;
/** Message ids remembered, so a message delivered twice is answered once. */
const SEEN_LIMIT = 200;
const COMMANDS = new Set([
  "start",
  "help",
  "new",
  "stop",
  "pair",
  "agent",
  "workspace",
  "model",
  "thinking",
  "effort",
  "sessions",
  "resume",
]);

type ChoiceKind = "agent" | "workspace" | "model" | "thinking";

export interface ZaloOwner {
  id: string;
  name: string;
}

export interface ZaloChannelDeps {
  token: string;
  /** Replaces the HTTP client built from `token` (tests). */
  api?: ZaloApi;
  gateway: ChannelGateway;
  pairing: PairingGuard;
  owner(): ZaloOwner | null;
  onPaired(owner: ZaloOwner): void;
  onState(state: ChannelState, error: string | null): void;
  t: ZaloTranslate;
}

interface ChatQueue {
  running: boolean;
  waiting: (() => Promise<void>)[];
}

function displayName(user: ZaloUser): string {
  return user.display_name?.trim() || user.id;
}

function parseCommand(text: string): { name: string; argument: string } | null {
  const match = /^\/([a-z_]+)(?:\s+([\s\S]*))?$/i.exec(text);
  const name = match?.[1]?.toLowerCase();
  return name && COMMANDS.has(name) ? { name, argument: (match?.[2] ?? "").trim() } : null;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * The Zalo bot: long polls for private messages, answers only the paired owner, and runs accepted
 * messages through the gateway. Zalo cannot edit a message, so an answer is sent once the agent
 * has finished, while the typing indicator runs.
 */
export class ZaloChannel {
  private readonly api: ZaloApi;
  private readonly prompts: ZaloPrompts;
  private readonly chats = new Map<string, ChatQueue>();
  private readonly seen = new Set<string>();
  private controller: AbortController | null = null;
  private loop: Promise<void> | null = null;
  private botName: string | null = null;
  private online = false;

  constructor(private readonly deps: ZaloChannelDeps) {
    this.api = deps.api ?? new HttpZaloApi(deps.token);
    this.prompts = new ZaloPrompts((chatId, text) => this.api.sendMessage(chatId, text), deps.t);
  }

  /**
   * Connects and starts polling. Returns the bot's account name, or null when Zalo could not be
   * reached yet (polling keeps retrying) or the token was refused. The state is reported through
   * `onState`. Calling it again while running returns the same name.
   */
  async start(): Promise<string | null> {
    if (this.loop) return this.botName;
    const controller = new AbortController();
    this.controller = controller;
    this.deps.onState("connecting", null);
    let outcome: "ready" | "retry" | "fatal" = "ready";
    try {
      await this.connect(controller.signal);
    } catch (error) {
      outcome = controller.signal.aborted ? "fatal" : this.failure(error);
    }
    this.loop = outcome === "fatal" ? Promise.resolve() : this.poll(controller.signal, outcome);
    return this.botName;
  }

  /** Stops polling and waits for the loop to end. Turns in progress are stopped. */
  async stop(): Promise<void> {
    const loop = this.loop;
    if (!this.controller || !loop) return;
    this.controller.abort();
    this.controller = null;
    this.loop = null;
    await loop;
    this.prompts.cancelAll();
    for (const [chatId, queue] of this.chats) {
      queue.waiting.length = 0;
      if (queue.running) void this.deps.gateway.abort(`zalo:${chatId}`).catch(() => {});
    }
    this.online = false;
    this.deps.onState("off", null);
  }

  /** Sends `text` to a chat, split to Zalo's length limit. */
  async notify(chatId: string, text: string): Promise<void> {
    for (const chunk of splitText(text, MESSAGE_LIMIT)) await this.api.sendMessage(chatId, chunk);
  }

  // -------------------------------------------------------------------------------------------
  // Polling
  // -------------------------------------------------------------------------------------------

  private setState(state: ChannelState, error: string | null): void {
    this.online = state === "online";
    this.deps.onState(state, error);
  }

  private async connect(signal: AbortSignal): Promise<void> {
    const me = await this.api.getMe(signal);
    try {
      await this.api.deleteWebhook(signal);
    } catch (error) {
      // Nothing to delete is fine; a refused token or a lost connection is not.
      if (
        signal.aborted ||
        (error instanceof ZaloApiError &&
          (error.kind === "unauthorized" || error.kind === "network"))
      )
        throw error;
    }
    this.botName = me.account_name ?? null;
    this.setState("online", null);
  }

  /** Reports a failure; "fatal" means retrying cannot help (the token is refused). */
  private failure(error: unknown): "retry" | "fatal" {
    const { t } = this.deps;
    if (error instanceof ZaloApiError && error.kind === "unauthorized") {
      this.setState("error", t("channels.zalo.tokenInvalid"));
      return "fatal";
    }
    this.setState("error", t("channels.zalo.unreachable", { error: (error as Error).message }));
    return "retry";
  }

  private async poll(signal: AbortSignal, initial: "ready" | "retry"): Promise<void> {
    let ready = initial === "ready";
    let failures = ready ? 0 : 1;
    while (!signal.aborted) {
      try {
        if (failures > 0)
          await abortableSleep(Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (failures - 1)), signal);
        if (!ready) {
          await this.connect(signal);
          ready = true;
        }
        const startedAt = Date.now();
        const updates = await this.api.getUpdates(signal);
        failures = 0;
        if (!this.online) this.setState("online", null);
        for (const update of updates) this.dispatch(update);
        const elapsed = Date.now() - startedAt;
        if (updates.length === 0 && elapsed < MIN_POLL_MS)
          await abortableSleep(MIN_POLL_MS - elapsed, signal);
      } catch (error) {
        if (signal.aborted) break;
        failures++;
        if (this.failure(error) === "fatal") break;
      }
    }
  }

  private dispatch(update: ZaloUpdate): void {
    this.handleUpdate(update).catch((error: unknown) => {
      console.warn("[zalo] An update could not be handled:", (error as Error).message);
    });
  }

  private async handleUpdate(update: ZaloUpdate): Promise<void> {
    const message = update.message;
    if (!update.event_name.startsWith("message.") || !message?.from || message.from.is_bot) return;
    // Groups are in beta on Zalo; the bot answers private chats only.
    if (message.chat.chat_type !== "PRIVATE") return;
    if (this.seen.has(message.message_id)) return;
    this.seen.add(message.message_id);
    if (this.seen.size > SEEN_LIMIT) this.seen.delete(this.seen.values().next().value!);
    await this.handleMessage(update, message, message.from);
  }

  // -------------------------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------------------------

  private async handleMessage(
    update: ZaloUpdate,
    message: ZaloMessage,
    from: ZaloUser,
  ): Promise<void> {
    const chatId = message.chat.id;
    const owner = this.deps.owner();
    const text = (message.text ?? "").trim();
    const command = parseCommand(text);

    if (!owner || from.id !== owner.id) {
      // Strangers get no answer. A pairing the owner opened is the one exception: its code may
      // come from anyone, and (if the bot already has an owner) it replaces that owner.
      if (command?.name === "pair" && (!owner || this.deps.pairing.isOpen(Date.now())))
        await this.pair(chatId, from, command.argument);
      else if (!owner && command?.name === "start") await this.reply(chatId, "start");
      return;
    }

    switch (command?.name) {
      case "start":
        await this.reply(chatId, "startPaired", { name: owner.name });
        return;
      case "help":
        await this.reply(chatId, "help");
        return;
      case "pair":
        await this.reply(chatId, "alreadyPaired");
        return;
      case "stop":
        await this.interrupt(chatId);
        await this.reply(chatId, "stopped");
        return;
      case "agent":
      case "workspace":
      case "model":
      case "thinking":
        await this.choose(chatId, command.name, command.argument);
        return;
      case "effort":
        await this.choose(chatId, "thinking", command.argument);
        return;
      case "new":
        await this.interrupt(chatId);
        try {
          await this.deps.gateway.newConversation(`zalo:${chatId}`);
          await this.reply(chatId, "newConversation");
        } catch (error) {
          await this.reply(chatId, "turnFailed", { error: (error as Error).message });
        }
        return;
      case "sessions":
        await this.listSessions(chatId);
        return;
      case "resume":
        await this.resumeSession(chatId, command.argument);
        return;
    }

    // The turn in progress waits for this reply (an approval or a question); queued, it would wait
    // behind the very turn that waits for it.
    if (update.event_name === "message.text.received" && this.prompts.handleText(chatId, text))
      return;

    const queue = this.queue(chatId);
    if (queue.waiting.length >= MAX_QUEUED_MESSAGES) {
      await this.reply(chatId, "busy");
      return;
    }
    queue.waiting.push(() => this.process(chatId, message));
    void this.drain(queue);
  }

  /** Replies with the chat's saved sessions, current first. */
  private async listSessions(chatId: string): Promise<void> {
    try {
      const sessions = await this.deps.gateway.listChatSessions(`zalo:${chatId}`);
      if (sessions.length === 0) {
        await this.reply(chatId, "noSessions");
        return;
      }
      const lines = sessions.map((s, i) => `${i + 1}. ${s.title}${s.isCurrent ? " ←" : ""}`);
      await this.sendPlain(chatId, lines.join("\n"));
    } catch (error) {
      await this.reply(chatId, "turnFailed", { error: (error as Error).message });
    }
  }

  /** Switches the chat to a previous session by number (1-based). */
  private async resumeSession(chatId: string, argument: string): Promise<void> {
    const index = Number(argument.trim());
    if (!Number.isInteger(index) || index < 1) {
      await this.reply(chatId, "resumeUsage");
      return;
    }
    try {
      const sessions = await this.deps.gateway.listChatSessions(`zalo:${chatId}`);
      const target = sessions[index - 1];
      if (!target) {
        await this.reply(chatId, "sessionNotFound", { number: index });
        return;
      }
      if (target.isCurrent) {
        await this.reply(chatId, "sessionAlreadyCurrent");
        return;
      }
      await this.interrupt(chatId);
      await this.deps.gateway.resumeChatSession(`zalo:${chatId}`, target.id);
      await this.reply(chatId, "sessionResumed", { title: target.title });
    } catch (error) {
      await this.reply(chatId, "turnFailed", { error: (error as Error).message });
    }
  }

  /** The list behind a command and what the chat uses now. */
  private async listFor(
    chatKey: string,
    kind: ChoiceKind,
  ): Promise<{ options: ChatOption[]; currentId: string | null }> {
    if (kind === "agent" || kind === "workspace") {
      const all = await this.deps.gateway.options(chatKey);
      return kind === "agent"
        ? { options: all.agents, currentId: all.agentId }
        : { options: all.workspaces, currentId: all.workspaceId };
    }
    return this.deps.gateway.pickOptions(chatKey, kind);
  }

  /** `/agent`, `/workspace`, `/model`, `/thinking`: switch to the one named, or list the choices. */
  private async choose(chatId: string, kind: ChoiceKind, argument: string): Promise<void> {
    const chatKey = `zalo:${chatId}`;
    try {
      const { options, currentId } = await this.listFor(chatKey, kind);
      if (options.length === 0) {
        await this.reply(chatId, "noChoices");
        return;
      }
      const query = argument.trim().toLowerCase();
      const match = query ? findOption(options, query) : undefined;
      if (match) {
        const { gateway } = this.deps;
        if (kind === "agent") await gateway.choose(chatKey, { agentId: match.id });
        else if (kind === "workspace") await gateway.choose(chatKey, { workspaceId: match.id });
        else await gateway.pick(chatKey, kind, match.id);
        await this.reply(chatId, `${kind}Changed`, { name: match.label });
        return;
      }
      const shown = options.slice(0, MAX_CHOICES);
      const current = options.find((option) => option.id === currentId);
      const heading = query ? (`${kind}NotFound` as const) : (`${kind}Prompt` as const);
      const lines = [
        this.deps.t(`channels.zalo.${heading}`, {
          name: current?.label ?? "",
          query: argument.trim(),
        }),
        ...shown.map(
          (option, index) => `${index + 1}. ${option.label}${option.id === currentId ? " ✓" : ""}`,
        ),
      ];
      if (options.length > shown.length)
        lines.push(
          this.deps.t("channels.zalo.moreChoices", { count: options.length - shown.length }),
        );
      lines.push(this.deps.t("channels.zalo.chooseHint", { command: kind }));
      await this.sendPlain(chatId, lines.join("\n"));
    } catch (error) {
      await this.reply(chatId, "turnFailed", { error: (error as Error).message });
    }
  }

  private async pair(chatId: string, from: ZaloUser, code: string): Promise<void> {
    if (!code) {
      await this.reply(chatId, "pairUsage");
      return;
    }
    const now = Date.now();
    const result = this.deps.pairing.attempt(code, now);
    if (result.status === "ok") {
      const name = displayName(from);
      this.deps.onPaired({ id: from.id, name });
      await this.reply(chatId, "pairSuccess", { name });
    } else if (result.status === "locked") {
      await this.reply(chatId, "pairLocked", {
        minutes: Math.max(1, Math.ceil((result.until - now) / 60_000)),
      });
    } else {
      await this.reply(chatId, "pairInvalid");
    }
  }

  /** Drops the messages waiting for the chat and stops the turn in progress. */
  private async interrupt(chatId: string): Promise<void> {
    const queue = this.chats.get(chatId);
    if (queue) queue.waiting.length = 0;
    this.prompts.cancelAll(chatId);
    try {
      await this.deps.gateway.abort(`zalo:${chatId}`);
    } catch (error) {
      console.warn("[zalo] Could not stop the turn:", (error as Error).message);
    }
  }

  private queue(chatId: string): ChatQueue {
    let queue = this.chats.get(chatId);
    if (!queue) {
      queue = { running: false, waiting: [] };
      this.chats.set(chatId, queue);
    }
    return queue;
  }

  /** Runs the waiting messages of a chat one after another. */
  private async drain(queue: ChatQueue): Promise<void> {
    if (queue.running) return;
    queue.running = true;
    try {
      for (let job = queue.waiting.shift(); job; job = queue.waiting.shift()) {
        try {
          await job();
        } catch (error) {
          console.warn("[zalo] A message could not be handled:", (error as Error).message);
        }
      }
    } finally {
      queue.running = false;
    }
  }

  // -------------------------------------------------------------------------------------------
  // One message becomes one turn
  // -------------------------------------------------------------------------------------------

  private async process(chatId: string, message: ZaloMessage): Promise<void> {
    const input = await this.readInput(chatId, message);
    if (input) await this.runTurn(chatId, input);
  }

  /** Collects text and attachments of a message; replies and returns null when it cannot. */
  private async readInput(chatId: string, message: ZaloMessage): Promise<ChannelInput | null> {
    const attachments: Attachment[] = [];
    let text = (message.text ?? message.caption ?? "").trim();

    if (message.photo_url) {
      try {
        const { data, mimeType } = await this.api.download(message.photo_url, MAX_DOWNLOAD_BYTES);
        const type = mimeType.startsWith("image/") ? mimeType : "image/jpeg";
        attachments.push({
          name: `photo.${IMAGE_EXTENSIONS[type] ?? "jpg"}`,
          mimeType: type,
          data: Buffer.from(data).toString("base64"),
        });
      } catch (error) {
        await this.replyDownloadFailure(chatId, error);
        return null;
      }
    }

    if (message.voice_url) {
      let voice: Awaited<ReturnType<ZaloApi["download"]>>;
      try {
        voice = await this.api.download(message.voice_url, MAX_DOWNLOAD_BYTES);
      } catch (error) {
        await this.replyDownloadFailure(chatId, error);
        return null;
      }
      try {
        const mimeType = voice.mimeType.startsWith("audio/") ? voice.mimeType : "audio/aac";
        const spoken = (await this.deps.gateway.transcribe(voice.data, mimeType)).trim();
        text = [spoken, text].filter(Boolean).join("\n\n");
      } catch (error) {
        await this.reply(chatId, "transcribeFailed", { error: (error as Error).message });
        return null;
      }
    }

    if (text === "" && attachments.length === 0) {
      await this.reply(chatId, "unsupported");
      return null;
    }
    return { text, attachments };
  }

  private async replyDownloadFailure(chatId: string, error: unknown): Promise<void> {
    if (error instanceof ZaloApiError && error.kind === "too_large")
      await this.reply(chatId, "fileTooLarge", { max: MAX_DOWNLOAD_BYTES / (1024 * 1024) });
    else await this.reply(chatId, "fileFailed", { error: (error as Error).message });
  }

  private async runTurn(chatId: string, input: ChannelInput): Promise<void> {
    const typing = () => void this.api.sendChatAction(chatId).catch(() => {});
    typing();
    const timer = setInterval(typing, TYPING_INTERVAL_MS);
    let lastText = "";
    let result: TurnResult;
    try {
      result = await this.deps.gateway.runTurn(`zalo:${chatId}`, input, {
        onText: (text) => {
          lastText = text;
        },
        onTool: () => {},
        askApproval: (request) => this.prompts.askApproval(chatId, request),
        askQuestion: (request) => this.prompts.askQuestions(chatId, request),
      });
    } catch (error) {
      await this.reply(chatId, "turnFailed", { error: (error as Error).message });
      return;
    } finally {
      clearInterval(timer);
    }
    const answer = result.text.trim() === "" ? lastText : result.text;
    await this.sendPlain(chatId, answer);
    if (result.status === "error")
      await this.reply(chatId, "turnFailed", {
        error: result.error?.trim() || this.deps.t("channels.zalo.unknownError"),
      });
    else if (result.status === "done" && answer.trim() === "")
      await this.reply(chatId, "emptyAnswer");
  }

  // -------------------------------------------------------------------------------------------
  // Plain replies
  // -------------------------------------------------------------------------------------------

  private async reply(
    chatId: string,
    key: ZaloTextName,
    vars?: Record<string, string | number>,
  ): Promise<void> {
    await this.sendPlain(chatId, this.deps.t(`channels.zalo.${key}`, vars));
  }

  private async sendPlain(chatId: string, text: string): Promise<void> {
    if (text.trim() === "") return;
    try {
      for (const chunk of splitText(text, MESSAGE_LIMIT)) await this.api.sendMessage(chatId, chunk);
    } catch (error) {
      console.warn("[zalo] A message could not be sent:", (error as Error).message);
    }
  }
}
