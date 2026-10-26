import type {
  ApprovalRequest,
  Attachment,
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
