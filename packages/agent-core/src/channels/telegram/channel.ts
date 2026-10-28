import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Attachment, ChannelState, TelegramChatSettings } from "@workspace/shared";
import type {
  ChannelGateway,
  ChannelInput,
  ChatOption,
  TurnResult,
  ChannelAdapter,
  PeerKey,
} from "../types.ts";
import {
  abortableSleep,
  HttpTelegramApi,
  MAX_DOWNLOAD_BYTES,
  TelegramApiError,
  type TelegramApi,
  type TelegramMessage,
  type TelegramUpdate,
  type TelegramUser,
} from "./api.ts";
import { TelegramApprovals } from "./approvals.ts";
import { TelegramQuestions } from "./questions.ts";
import { formatMessage, sendFormatted, splitText } from "./format.ts";
import { LiveMessage } from "./live-message.ts";
import type { PairingGuard } from "./pairing.ts";
import type { TelegramTextName, TelegramTranslate } from "./text.ts";

/** Messages that may wait behind the turn in progress, per chat. */
export const MAX_QUEUED_MESSAGES = 5;
const MAX_BACKOFF_MS = 30_000;
const COMMANDS: Record<string, true> = {
  start: true,
  help: true,
  new: true,
  stop: true,
  pair: true,
  agent: true,
  workspace: true,
  model: true,
  thinking: true,
  // Another name for /thinking; the menu lists only the first.
  effort: true,
};
/** Callback data of the `/agent` and `/workspace` buttons: `ch:<a|w>:<position in the list>`. */
const CHOICE_CALLBACK = /^ch:([awmt]):(\d+)$/;
/** Most buttons one list shows (Telegram allows 100 per message; a model list can be long). */
const MAX_BUTTONS = 30;
/** Lists offered with buttons that can still be tapped; the oldest are forgotten beyond this. */
const MAX_OFFERS = 50;

type ChoiceKind = "agent" | "workspace" | "model" | "thinking";
const KIND_LETTER: Record<ChoiceKind, string> = {
  agent: "a",
  workspace: "w",
  model: "m",
  thinking: "t",
};
const LETTER_KIND: Record<string, ChoiceKind> = {
  a: "agent",
  w: "workspace",
  m: "model",
  t: "thinking",
};

/** The name of an option without its icon, in lower case, for matching what the person typed. */
function plainName(label: string): string {
  return label
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .trim()
    .toLowerCase();
}

/** The option a person meant: its number in the list, its exact name, or a unique partial name. */
function findOption(options: readonly ChatOption[], query: string): ChatOption | undefined {
  if (/^\d+$/.test(query)) return options[Number(query) - 1];
  const exact = options.filter((option) => plainName(option.label) === query);
  if (exact.length === 1) return exact[0];
  const partial = options.filter((option) => plainName(option.label).includes(query));
  return partial.length === 1 ? partial[0] : undefined;
}

export interface TelegramOwner {
  id: number;
  name: string;
}

export interface TelegramChannelDeps {
  token: string;
  /** Replaces the HTTP client built from `token` (tests). */
  api?: TelegramApi;
  gateway: ChannelGateway;
  pairing: PairingGuard;
  owner(): TelegramOwner | null;
  onPaired(owner: TelegramOwner): void;
  onState(state: ChannelState, error: string | null): void;
  t: TelegramTranslate;

  /** Where to persist the poll offset. */
  dataDir?: string;
  /** App settings for per-chat config. */
  settings?: {
    get(): { channels: { telegram: { chats?: Record<string, TelegramChatSettings> } } };
  };
}

interface ChatQueue {
  running: boolean;
  waiting: (() => Promise<void>)[];
}

/** Telegram files get a unique name under the OS temp folder, without any path from the sender. */
function safeFileName(name: string | undefined): string {
  const cleaned = basename(name ?? "")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(-80);
  return cleaned || "file";
}

function displayName(user: TelegramUser): string {
  return (
    [user.first_name, user.last_name].filter(Boolean).join(" ").trim() ||
    user.username ||
    String(user.id)
  );
}

function parseCommand(text: string): { name: string; argument: string } | null {
  const match = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text);
  const name = match?.[1]?.toLowerCase();
  return name && COMMANDS[name] ? { name, argument: (match?.[2] ?? "").trim() } : null;
}

/**
 * The Telegram bot: long polls for updates and turns each private message from the paired person
 * into an agent turn through the gateway. Nobody else gets an answer.
 */
export class TelegramChannel implements ChannelAdapter {
  private readonly api: TelegramApi;
  private readonly approvals: TelegramApprovals;
  private readonly questions: TelegramQuestions;
  private readonly chats = new Map<number, ChatQueue>();
  /** The lists behind the buttons of `/agent` and `/workspace`, by `<chat>:<message>`. */
  private readonly offers = new Map<string, { kind: ChoiceKind; options: ChatOption[] }>();
  private controller: AbortController | null = null;
  private loop: Promise<void> | null = null;
  private username: string | null = null;
  private online = false;

  constructor(private readonly deps: TelegramChannelDeps) {
    this.api = deps.api ?? new HttpTelegramApi(deps.token);
    this.approvals = new TelegramApprovals(this.api, deps.t);
    this.questions = new TelegramQuestions(this.api, deps.t);
  }

  /**
   * Connects and starts polling. Returns the bot's username, or null when Telegram could not be
   * reached yet (polling keeps retrying) or the token was refused. The state is reported through
   * `onState`. Calling it again while running returns the same username.
   */
  async start(): Promise<string | null> {
    if (this.loop) return this.username;
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
    return this.username;
  }

  /** Stops polling and waits for the loop to end. Turns in progress are stopped. */
  async stop(): Promise<void> {
    const loop = this.loop;
    if (!this.controller || !loop) return;
    this.controller.abort();
    this.controller = null;
    this.loop = null;
    await loop;
    this.approvals.denyAll();
    this.questions.skipAll();
    for (const [chatId, queue] of this.chats) {
      queue.waiting.length = 0;
      if (queue.running) void this.deps.gateway.abort(`telegram:${chatId}`).catch(() => {});
    }
    this.online = false;
    this.deps.onState("off", null);
  }

  /** Sends `text` (Markdown) to a private chat, split to Telegram's length limit. */
  async notify(chatId: number, text: string): Promise<void> {
    for (const chunk of formatMessage(text)) await sendFormatted(this.api, chatId, chunk);
  }

  // ChannelAdapter conformance: the gateway core calls these.
  readonly channel = "telegram";

  async send(peer: PeerKey, text: string): Promise<string | null> {
    const id = Number(peer.split(":").pop());
    if (Number.isNaN(id)) throw new Error(`Invalid peer key: ${peer}`);
    for (const chunk of formatMessage(text)) await sendFormatted(this.api, id, chunk);
    return null;
  }

  async edit(peer: PeerKey, messageId: string, text: string): Promise<void> {
    const id = Number(peer.split(":").pop());
    if (Number.isNaN(id)) throw new Error(`Invalid peer key: ${peer}`);
    await this.api.editMessageText(id, Number(messageId), text);
  }

  async delete(peer: PeerKey, messageId: string): Promise<void> {
    const id = Number(peer.split(":").pop());
    if (Number.isNaN(id)) throw new Error(`Invalid peer key: ${peer}`);
    await this.api.deleteMessage(id, Number(messageId));
  }

  async setTyping(peer: PeerKey): Promise<void> {
    const id = Number(peer.split(":").pop());
    if (Number.isNaN(id)) return;
    await this.api.sendChatAction(id, "typing").catch(() => {});
  }

  isOnline(): boolean {
    return this.online;
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
    await this.api.deleteWebhook(signal);
    await this.publishCommands(signal);
    this.username = me.username ?? null;
    this.setState("online", null);
  }

  /**
   * The menu Telegram shows on `/`, in the app's language at this moment. The bot works without
   * it, so a failure is only logged.
   */
  private async publishCommands(signal: AbortSignal): Promise<void> {
    const { t } = this.deps;
    try {
      await this.api.setMyCommands(
        [
          { command: "new", description: t("channels.telegram.commandNew") },
          { command: "agent", description: t("channels.telegram.commandAgent") },
          { command: "workspace", description: t("channels.telegram.commandWorkspace") },
          { command: "model", description: t("channels.telegram.commandModel") },
          { command: "thinking", description: t("channels.telegram.commandThinking") },
          { command: "stop", description: t("channels.telegram.commandStop") },
          { command: "sessions", description: t("channels.telegram.commandSessions") },
          { command: "resume", description: t("channels.telegram.commandResume") },
          { command: "help", description: t("channels.telegram.commandHelp") },
        ],
        signal,
      );
    } catch (error) {
      if (signal.aborted) throw error;
      console.warn("[telegram] The command menu could not be set:", (error as Error).message);
    }
  }

  /** Reports a failure; "fatal" means retrying cannot help (the token is refused). */
  private failure(error: unknown): "retry" | "fatal" {
    const { t } = this.deps;
    const kind = error instanceof TelegramApiError ? error.kind : null;
    if (kind === "unauthorized") {
      this.setState("error", t("channels.telegram.tokenInvalid"));
      return "fatal";
    }
    if (kind === "conflict") this.setState("error", t("channels.telegram.conflict"));
    else
      this.setState(
        "error",
        t("channels.telegram.unreachable", { error: (error as Error).message }),
      );
    return "retry";
  }

  private async poll(signal: AbortSignal, initial: "ready" | "retry"): Promise<void> {
    let ready = initial === "ready";
    let failures = ready ? 0 : 1;
    let offset = this.loadOffset();
    while (!signal.aborted) {
      try {
        if (failures > 0)
          await abortableSleep(Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (failures - 1)), signal);
        if (!ready) {
          await this.connect(signal);
          ready = true;
        }
        const updates = await this.api.getUpdates(offset, signal);
        failures = 0;
        if (!this.online) this.setState("online", null);
        for (const update of updates) {
          this.dispatch(update);
          offset = Math.max(offset, update.update_id + 1);
        }
        // Persist the offset so a restart does not re-process these updates.
        this.saveOffset(offset);
      } catch (error) {
        if (signal.aborted) break;
        failures++;
        if (this.failure(error) === "fatal") break;
      }
    }
  }

  /** Saves the poll offset so a restart resumes from here. */
  private saveOffset(offset: number): void {
    if (!this.deps.dataDir) return;
    try {
      const file = join(this.deps.dataDir, "telegram-offset.json");
      writeFileSync(file, JSON.stringify({ offset }), { mode: 0o600 });
    } catch {
      // Best effort: a lost offset means re-processing, which is safe (at-least-once).
    }
  }

  /** Reads the saved poll offset; 0 when none. */
  private loadOffset(): number {
    if (!this.deps.dataDir) return 0;
    try {
      const file = join(this.deps.dataDir, "telegram-offset.json");
      const raw = JSON.parse(readFileSync(file, "utf8")) as { offset?: unknown };
      return typeof raw.offset === "number" && raw.offset > 0 ? raw.offset : 0;
    } catch {
      return 0;
    }
  }

  private dispatch(update: TelegramUpdate): void {
    this.handleUpdate(update).catch((error: unknown) => {
      console.warn("[telegram] An update could not be handled:", (error as Error).message);
    });
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      const ownerId = this.deps.owner()?.id ?? null;
      if (
        !(await this.approvals.handleCallback(update.callback_query, ownerId)) &&
        !(await this.questions.handleCallback(update.callback_query, ownerId))
      )
        await this.handleChoiceCallback(update.callback_query, ownerId);
      return;
    }
    const message = update.message;
    if (!message?.from || message.from.is_bot || message.chat.type !== "private") return;
    await this.handleMessage(message, message.from);
  }

  // -------------------------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------------------------

  /** Per-chat settings from Settings › Channels; empty when none are configured. */
  private chatSettings(chatId: number): TelegramChatSettings {
    const chats = this.deps.settings?.get().channels.telegram.chats;
    return chats?.[String(chatId)] ?? {};
  }

  /** True when `from` may talk in this chat (owner, or in the chat's allowlist). */
  private isAllowed(chatId: number, from: TelegramUser): boolean {
    const owner = this.deps.owner();
    if (owner && from.id === owner.id) return true;
    const settings = this.chatSettings(chatId);
    if (settings.access !== "members") return false;
    if (!settings.allowedUsers || settings.allowedUsers.length === 0) return true;
    return settings.allowedUsers.includes(from.id);
  }

  private async handleMessage(message: TelegramMessage, from: TelegramUser): Promise<void> {
    const chatId = message.chat.id;
    const owner = this.deps.owner();
    const command = parseCommand((message.text ?? "").trim());

    if (!this.isAllowed(chatId, from)) {
      // Strangers get no answer. A pairing the owner opened is the one exception: its code may
      // come from anyone, and (if the bot already has an owner) it replaces that owner.
      if (command?.name === "pair" && (!owner || this.deps.pairing.isOpen(Date.now())))
        await this.pair(chatId, from, command.argument);
      else if (!owner && command?.name === "start") await this.reply(chatId, "start");
      return;
    }

    switch (command?.name) {
      case "start":
        await this.reply(chatId, "startPaired", { name: owner?.name ?? "" });
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
          await this.deps.gateway.newConversation(`telegram:${chatId}`);
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

    // The turn in progress waits for this text (the person tapped "Other"); queued, it would wait
    // behind the very turn that waits for it.
    const plain = !message.photo && !message.document && !message.voice && !message.audio;
    if (plain && message.text && this.questions.handleText(chatId, message.text)) return;

    // Busy mode: steer joins the running turn, interrupt stops it, queue waits.
    const busyMode = this.chatSettings(chatId).busyMode ?? "queue";
    const queue = this.queue(chatId);
    if (queue.running && busyMode === "steer") {
      await this.deps.gateway
        .steerTurn(`telegram:${chatId}`, {
          text: message.text ?? "",
          attachments: [],
        })
        .catch(() => {});
      return;
    }
    if (queue.running && busyMode === "interrupt") {
      await this.deps.gateway.abort(`telegram:${chatId}`).catch(() => {});
    }
    if (queue.waiting.length >= MAX_QUEUED_MESSAGES) {
      await this.reply(chatId, "busy");
      return;
    }
    queue.waiting.push(() => this.process(chatId, message));
    void this.drain(queue);
  }

  /** Replies with the chat's saved sessions, current first. */
  private async listSessions(chatId: number): Promise<void> {
    try {
      const sessions = await this.deps.gateway.listChatSessions(`telegram:${chatId}`);
      if (sessions.length === 0) {
        await this.reply(chatId, "noSessions");
        return;
      }
      const lines = sessions.map((s, i) => {
        const marker = s.isCurrent ? " ←" : "";
        return `${i + 1}. ${s.title}${marker}`;
      });
      await this.api.sendMessage(chatId, lines.join("\n"));
    } catch (error) {
      await this.reply(chatId, "turnFailed", { error: (error as Error).message });
    }
  }

  /** Switches the chat to a previous session by number (1-based). */
  private async resumeSession(chatId: number, argument: string): Promise<void> {
    const index = Number(argument.trim());
    if (!Number.isInteger(index) || index < 1) {
      await this.api.sendMessage(chatId, "Usage: /resume <number>  (see /sessions)");
      return;
    }
    try {
      const sessions = await this.deps.gateway.listChatSessions(`telegram:${chatId}`);
      const target = sessions[index - 1];
      if (!target) {
        await this.api.sendMessage(chatId, `No session #${index}. See /sessions.`);
        return;
      }
      if (target.isCurrent) {
        await this.api.sendMessage(chatId, "That session is already current.");
        return;
      }
      await this.interrupt(chatId);
      await this.deps.gateway.resumeChatSession(`telegram:${chatId}`, target.id);
      await this.api.sendMessage(chatId, `Switched to: ${target.title}`);
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

  /** `/agent`, `/workspace`, `/model`, `/thinking`: switch to the one named, or offer the list. */
  private async choose(chatId: number, kind: ChoiceKind, argument: string): Promise<void> {
    try {
      const { options, currentId } = await this.listFor(`telegram:${chatId}`, kind);
      if (options.length === 0) {
        await this.reply(chatId, "noChoices");
        return;
      }
      const query = argument.trim().toLowerCase();
      const match = query ? findOption(options, query) : undefined;
      if (match) {
        await this.reply(chatId, ...(await this.apply(chatId, kind, match)));
        return;
      }
      const shown = options.slice(0, MAX_BUTTONS);
      const current = options.find((option) => option.id === currentId);
      let text = this.deps.t(
        query ? `channels.telegram.${kind}NotFound` : `channels.telegram.${kind}Prompt`,
        { name: current?.label ?? "", query: argument.trim() },
      );
      if (options.length > shown.length)
        text += `\n${this.deps.t("channels.telegram.moreChoices", { count: options.length - shown.length })}`;
      const { message_id: messageId } = await this.api.sendMessage(chatId, text, {
        replyMarkup: {
          inline_keyboard: shown.map((option, index) => [
            {
              text: option.id === currentId ? `✓ ${option.label}` : option.label,
              callback_data: `ch:${KIND_LETTER[kind]}:${index}`,
            },
          ]),
        },
      });
      this.offers.set(`${chatId}:${messageId}`, { kind, options: shown });
      for (const key of [...this.offers.keys()].slice(
        0,
        Math.max(0, this.offers.size - MAX_OFFERS),
      ))
        this.offers.delete(key);
    } catch (error) {
      await this.reply(chatId, "turnFailed", { error: (error as Error).message });
    }
  }

  /** Switches the chat and returns the sentence that confirms it. */
  private async apply(
    chatId: number,
    kind: ChoiceKind,
    option: ChatOption,
  ): Promise<[TelegramTextName, Record<string, string>]> {
    const chatKey = `telegram:${chatId}`;
    const { gateway } = this.deps;
    if (kind === "agent") await gateway.choose(chatKey, { agentId: option.id });
    else if (kind === "workspace") await gateway.choose(chatKey, { workspaceId: option.id });
    else await gateway.pick(chatKey, kind, option.id);
    return [`${kind}Changed`, { name: option.label }];
  }

  private async handleChoiceCallback(
    query: NonNullable<TelegramUpdate["callback_query"]>,
    ownerId: number | null,
  ): Promise<void> {
    const match = CHOICE_CALLBACK.exec(query.data ?? "");
    if (!match) return;
    const message = query.message;
    if (ownerId === null || query.from.id !== ownerId || !message) {
      await this.api.answerCallbackQuery(query.id).catch(() => {});
      return;
    }
    const chatId = message.chat.id;
    const offer = this.offers.get(`${chatId}:${message.message_id}`);
    const option = offer?.options[Number(match[2])];
    if (!offer || !option || offer.kind !== LETTER_KIND[match[1]!]) {
      await this.api
        .answerCallbackQuery(query.id, this.deps.t("channels.telegram.expired"))
        .catch(() => {});
      return;
    }
    await this.api.answerCallbackQuery(query.id).catch(() => {});
    try {
      const [key, vars] = await this.apply(chatId, offer.kind, option);
      this.offers.delete(`${chatId}:${message.message_id}`);
      await this.api
        .editMessageText(
          chatId,
          message.message_id,
          this.deps.t(`channels.telegram.${key}`, vars),
          {
            replyMarkup: { inline_keyboard: [] },
          },
        )
        .catch(() => {});
    } catch (error) {
      await this.reply(chatId, "turnFailed", { error: (error as Error).message });
    }
  }

  private async pair(chatId: number, from: TelegramUser, code: string): Promise<void> {
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
  private async interrupt(chatId: number): Promise<void> {
    const queue = this.chats.get(chatId);
    if (queue) queue.waiting.length = 0;
    this.approvals.denyAll(chatId);
    this.questions.skipAll(chatId);
    try {
      await this.deps.gateway.abort(`telegram:${chatId}`);
    } catch (error) {
      console.warn("[telegram] Could not stop the turn:", (error as Error).message);
    }
  }

  private queue(chatId: number): ChatQueue {
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
          console.warn("[telegram] A message could not be handled:", (error as Error).message);
        }
      }
    } finally {
      queue.running = false;
    }
  }

  // -------------------------------------------------------------------------------------------
  // One message becomes one turn
  // -------------------------------------------------------------------------------------------

  private async process(chatId: number, message: TelegramMessage): Promise<void> {
    const temporary: string[] = [];
    try {
      const input = await this.readInput(chatId, message, temporary);
      if (input) await this.runTurn(chatId, input);
    } finally {
      await Promise.all(temporary.map((path) => rm(path, { force: true }).catch(() => {})));
    }
  }

  /** Collects text and attachments of a message; replies and returns null when it cannot. */
  private async readInput(
    chatId: number,
    message: TelegramMessage,
    temporary: string[],
  ): Promise<ChannelInput | null> {
    const attachments: Attachment[] = [];
    let text = (message.text ?? message.caption ?? "").trim();
    try {
      const photo = message.photo?.reduce((best, size) =>
        (size.file_size ?? size.width * size.height) > (best.file_size ?? best.width * best.height)
          ? size
          : best,
      );
      if (photo) {
        const { data } = await this.api.downloadFile(photo.file_id, MAX_DOWNLOAD_BYTES);
        attachments.push({
          name: "photo.jpg",
          mimeType: "image/jpeg",
          data: Buffer.from(data).toString("base64"),
        });
      }
      if (message.document) {
        const { data } = await this.api.downloadFile(message.document.file_id, MAX_DOWNLOAD_BYTES);
        const name = safeFileName(message.document.file_name);
        const directory = join(tmpdir(), "pp-agent-telegram");
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const path = join(directory, `${randomUUID()}-${name}`);
        await writeFile(path, data, { mode: 0o600 });
        temporary.push(path);
        attachments.push({
          name,
          mimeType: message.document.mime_type ?? "application/octet-stream",
          path,
        });
      }
    } catch (error) {
      await this.replyDownloadFailure(chatId, error);
      return null;
    }

    const voice = message.voice ?? message.audio;
    if (voice) {
      let data: Uint8Array;
      try {
        ({ data } = await this.api.downloadFile(voice.file_id, MAX_DOWNLOAD_BYTES));
      } catch (error) {
        await this.replyDownloadFailure(chatId, error);
        return null;
      }
      try {
        const mimeType = voice.mime_type ?? (message.voice ? "audio/ogg" : "audio/mpeg");
        const spoken = (await this.deps.gateway.transcribe(data, mimeType)).trim();
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

  private async replyDownloadFailure(chatId: number, error: unknown): Promise<void> {
    if (error instanceof TelegramApiError && error.kind === "too_large")
      await this.reply(chatId, "fileTooLarge", { max: MAX_DOWNLOAD_BYTES / (1024 * 1024) });
    else await this.reply(chatId, "fileFailed", { error: (error as Error).message });
  }

  private async runTurn(chatId: number, input: ChannelInput): Promise<void> {
    const live = new LiveMessage(this.api, chatId);
    live.start();
    let lastText = "";
    let result: TurnResult;
    try {
      result = await this.deps.gateway.runTurn(`telegram:${chatId}`, input, {
        onText: (text) => {
          lastText = text;
          live.update(text);
        },
        onTool: (summary) => live.setStatus(summary),
        askApproval: (request) => this.approvals.ask(chatId, request),
        askQuestion: (request) => this.questions.ask(chatId, request),
      });
    } catch (error) {
      live.dispose();
      await this.reply(chatId, "turnFailed", { error: (error as Error).message });
      return;
    }
    const answer = result.text.trim() === "" ? lastText : result.text;
    try {
      await live.finish(answer);
    } catch (error) {
      console.warn("[telegram] The reply could not be completed:", (error as Error).message);
      // The formatted reply failed for good; send the words themselves.
      await this.sendPlain(chatId, answer);
    }
    if (result.status === "error")
      await this.reply(chatId, "turnFailed", {
        error: result.error?.trim() || this.deps.t("channels.telegram.unknownError"),
      });
    else if (result.status === "done" && answer.trim() === "")
      await this.reply(chatId, "emptyAnswer");
  }

  // -------------------------------------------------------------------------------------------
  // Plain replies
  // -------------------------------------------------------------------------------------------

  private async reply(
    chatId: number,
    key: TelegramTextName,
    vars?: Record<string, string | number>,
  ): Promise<void> {
    await this.sendPlain(chatId, this.deps.t(`channels.telegram.${key}`, vars));
  }

  private async sendPlain(chatId: number, text: string): Promise<void> {
    if (text.trim() === "") return;
    try {
      for (const chunk of splitText(text)) await this.api.sendMessage(chatId, chunk);
    } catch (error) {
      console.warn("[telegram] A message could not be sent:", (error as Error).message);
    }
  }
}
