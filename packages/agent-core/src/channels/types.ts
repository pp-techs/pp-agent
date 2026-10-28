import type {
  ApprovalRequest,
  Attachment,
  QuestionAnswer,
  QuestionRequest,
  SaveTelegramInput,
  TelegramStatus,
} from "@workspace/shared";

/** One message a person sent through a chat channel. */
export interface ChannelInput {
  text: string;
  /** Images may carry base64 `data`; other files must carry a `path` the host can copy from. */
  attachments: Attachment[];
}

/** Callbacks of one turn; the channel turns them into chat messages. */
export interface TurnHooks {
  /** Everything the assistant has written so far in this turn (not a delta). */
  onText(text: string): void;
  /** A tool starts running; `summary` is a short human line such as "Reading report.docx". */
  onTool(summary: string): void;
  /** Resolves true when the person approved. The channel should settle (deny) on its own timeout. */
  askApproval(request: ApprovalRequest): Promise<boolean>;
  /**
   * Resolves with one answer per question, or null when the person skips them. The channel should
   * settle (skip) on its own timeout.
   */
  askQuestion(request: QuestionRequest): Promise<QuestionAnswer[] | null>;
}

export interface TurnResult {
  /** Final assistant text; empty when the turn produced none. */
  text: string;
  status: "done" | "error" | "aborted";
  error?: string;
}

/** An agent or workspace a person can pick in the chat. */
export interface ChatOption {
  id: string;
  /** Icon and name, as shown in the app. */
  label: string;
}

/** What `/agent` and `/workspace` offer, and what the chat uses now. */
export interface ChatChoices {
  agents: ChatOption[];
  workspaces: ChatOption[];
  agentId: string;
  workspaceId: string;
}

/** What `/model` and `/thinking` offer for a chat, and what it uses now (null when unknown). */
export interface ChatPick {
  options: ChatOption[];
  currentId: string | null;
}

/** `model`: models that can run now. `thinking`: levels the chat's current model offers. */
export type ChatPickKind = "model" | "thinking";

/**
 * What a channel adapter uses to talk to the agent. Implemented by AgentHost. Each `chatKey`
 * (for example `telegram:123456`) has its own saved conversation, separate from the one open in
 * the desktop window, and turns of one chat run one at a time.
 */
export interface ChannelGateway {
  /** Runs one turn and resolves when the agent has settled. */
  runTurn(chatKey: string, input: ChannelInput, hooks: TurnHooks): Promise<TurnResult>;
  /** Starts a fresh conversation for the chat (the next turn opens a new session). */
  newConversation(chatKey: string): Promise<void>;
  /** Stops the turn in progress for the chat, if any; pending approvals are denied. */
  abort(chatKey: string): Promise<void>;
  /** The agents and workspaces to pick from, and the ones this chat uses now. */
  options(chatKey: string): Promise<ChatChoices>;
  /**
   * Picks the agent and/or workspace of this chat (ids from `options`). A new agent continues the
   * conversation; a new workspace starts a new one. Rejects unknown ids.
   */
  choose(chatKey: string, choice: { agentId?: string; workspaceId?: string }): Promise<void>;
  /**
   * The models or thinking levels to pick from for this chat. The conversation's own session is
   * opened for it. Rejects while the chat is answering, as the window does.
   */
  pickOptions(chatKey: string, kind: ChatPickKind): Promise<ChatPick>;
  /** Applies a pick (an id from `pickOptions`) to this conversation only. */
  pick(chatKey: string, kind: ChatPickKind, id: string): Promise<void>;
  /** Speech-to-text with the voice provider chosen in Settings; throws when none is set up. */
  transcribe(data: Uint8Array, mimeType: string): Promise<string>;
  /** The chat's saved sessions (current first, then history), for `/sessions`. */
  listChatSessions(
    chatKey: string,
  ): Promise<Array<{ id: string; title: string; isCurrent: boolean }>>;
  /** Switches the chat to a previous session; rejects when it is not in the history. */
  resumeChatSession(chatKey: string, sessionId: string): Promise<void>;
  /**
   * Injects a message into the turn in progress (steering). Returns true only when accepted;
   * false when no turn can accept it, so the caller can queue the input instead.
   */
  steerTurn(chatKey: string, input: ChannelInput): Promise<boolean>;
}

/** Telegram status and configuration commands as the host exposes them. */
export interface TelegramControl {
  status(): Promise<TelegramStatus>;
  save(input: SaveTelegramInput): Promise<TelegramStatus>;
  /** Opens a pairing window and returns the status with the one-time code. */
  startPairing(): Promise<TelegramStatus>;
  /** Removes the token and the paired owner and turns the channel off. */
  forget(): Promise<TelegramStatus>;
}

// -------------------------------------------------------------------------------------------
// Gateway core: peer keys, adapter interface, command registry
// -------------------------------------------------------------------------------------------

/**
 * A chat address: `<channel>:<account>:<kind>:<id>[:<thread>]`, for example `telegram:default:dm:123`
 * or `telegram:default:group:-100456`. The legacy `telegram:<id>` form is still accepted and
 * normalized on read.
 */
export type PeerKey = string;

/** Parse a peer key into its parts; null when it does not fit the pattern. */
export function parsePeerKey(key: PeerKey): {
  channel: string;
  account: string;
  kind: string;
  id: string;
  thread?: string;
} | null {
  const parts = key.split(":");
  if (parts.length < 4) return null;
  const [channel, account, kind, id, thread] = parts;
  if (!channel || !account || !kind || !id) return null;
  return { channel, account, kind, id, ...(thread ? { thread } : {}) };
}

/** Build a peer key from its parts. */
export function peerKey(
  channel: string,
  account: string,
  kind: string,
  id: string,
  thread?: string,
): PeerKey {
  return thread
    ? `${channel}:${account}:${kind}:${id}:${thread}`
    : `${channel}:${account}:${kind}:${id}`;
}

/** What a channel adapter can do. Each platform implements this; the gateway core calls it. */
export interface ChannelAdapter {
  /** The channel identifier (`telegram`, `slack`, …). */
  readonly channel: string;
  /** Sends a text message to a peer. Returns the platform message id, if any. */
  send(peer: PeerKey, text: string): Promise<string | null>;
  /** Sends a message with inline buttons; `callbackPrefix` scopes the callback data. */
  sendButtons?(
    peer: PeerKey,
    text: string,
    buttons: Array<{ text: string; data: string }>,
    callbackPrefix: string,
  ): Promise<string | null>;
  /** Edits a previously sent message. */
  edit?(peer: PeerKey, messageId: string, text: string): Promise<void>;
  /** Deletes a message. */
  delete?(peer: PeerKey, messageId: string): Promise<void>;
  /** Shows a typing/activity indicator. */
  setTyping?(peer: PeerKey): Promise<void>;
  /** True when the adapter is connected and can send. */
  isOnline(): boolean;
}

/** A parsed slash command from a chat message. */
export interface ParsedCommand {
  name: string;
  argument: string;
}

/** Parses `/command argument` from message text; null when the text is not a command. */
export function parseCommand(text: string): ParsedCommand | null {
  const match = /^\/([a-z_]+)\s*(.*)/s.exec(text.trim());
  return match ? { name: match[1], argument: match[2].trim() } : null;
}

/** Handlers for slash commands, shared across channels. */
export type CommandHandler = (argument: string, peer: PeerKey) => Promise<string | null>;

/** Registry of slash commands; each channel delegates to this instead of a switch statement. */
export class CommandRegistry {
  private readonly handlers = new Map<string, CommandHandler>();

  register(name: string, handler: CommandHandler): void {
    this.handlers.set(name, handler);
  }

  /** Runs the handler for `command`; returns the reply text, or null when the command is unknown. */
  async dispatch(command: ParsedCommand, peer: PeerKey): Promise<string | null> {
    const handler = this.handlers.get(command.name);
    return handler ? handler(command.argument, peer) : null;
  }

  /** Names of all registered commands, for `/help` and the Telegram command menu. */
  names(): string[] {
    return [...this.handlers.keys()];
  }
}
