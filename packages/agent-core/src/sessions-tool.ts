/**
 * `sessions`: lets the agent see the conversations the app has saved (the window's, chat
 * channels', scheduled runs'), read the end of one, and see the chats it can deliver a message to.
 * Read only. A chat's or a scheduled run's agent may be limited to its own session.
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  formatHistory,
  formatHistoryAround,
  formatSearchMatches,
  formatSessions,
  HISTORY_LIMIT,
  parseTimeBound,
  rankSessionMatches,
  searchSessionHistory,
  SESSION_LIST_LIMIT,
  selectSessions,
  type HistoryLine,
  type SessionKind,
  type SessionRow,
  type SessionSearchMatch,
  type SessionVisibility,
} from "./session-index.ts";

export const SESSIONS_TOOL = "sessions";

/** A chat the agent can deliver to. */
export interface PeerRow {
  /** `home` for the person's own chat, else the chat key. */
  id: string;
  label: string;
  /** Chat key such as `telegram:123`. */
  key: string;
}

/** What the tool reads from the host. */
export interface SessionsAccess {
  /** Every saved session, newest first, with `isCurrent` set. */
  list(): Promise<SessionRow[]>;
  /** The messages of one session; empty when it has none yet. */
  history(id: string): Promise<HistoryLine[]>;
  /** The id of the session this tool runs in, if it has been saved. */
  currentId(): string | null;
  peers(): PeerRow[];
  visibility(): SessionVisibility;
  locale(): string;
}

const KINDS = ["chat", "task", "window"] as const satisfies readonly SessionKind[];
/** Maximum recent sessions scanned during full-text `search`. */
const SEARCH_SCAN_LIMIT = 150;
const SEARCH_CONCURRENCY = 8;
const DEFAULT_SEARCH_LIMIT = 10;

export function createSessionsTool(access: SessionsAccess) {
  return defineTool({
    name: SESSIONS_TOOL,
    label: "Conversations",
    description:
      "Looks at the conversations saved in this app. action `search` searches all messages across past sessions (accent-insensitive; scheduled runs are ranked below interactive chats; supports `after`/`before` like '7d', '24h', '2026-10-01'); `list` shows sessions (newest first; filter by kind, peer or title/preview words); `history` reads the last messages of one session by id, or scrolls around a specific message index with `around`; `peers` shows the chats a message can be delivered to. Kinds: `window` (the desktop app), `chat` (a chat channel such as Telegram; its peer is the chat key) and `task` (a scheduled run). Read only. Use ids exactly as listed.",
    promptSnippet:
      "Search, list, and read saved conversations and see where messages can be delivered",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("search"),
        Type.Literal("list"),
        Type.Literal("history"),
        Type.Literal("peers"),
      ]),
      query: Type.Optional(
        Type.String({ description: "search: words to find across all messages of saved sessions" }),
      ),
      kind: Type.Optional(
        Type.Union(
          KINDS.map((kind) => Type.Literal(kind)),
          { description: "list/search: only this kind of session" },
        ),
      ),
      peer: Type.Optional(
        Type.String({ description: "list/search: only this chat key, e.g. telegram:123" }),
      ),
      search: Type.Optional(
        Type.String({ description: "list: words that must occur in the title or first message" }),
      ),
      after: Type.Optional(
        Type.String({
          description: "search: only messages on/after this time ('24h', '7d', '2w', or ISO date)",
        }),
      ),
      before: Type.Optional(
        Type.String({
          description: "search: only messages on/before this time ('24h', '7d', '2w', or ISO date)",
        }),
      ),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: Math.max(SESSION_LIST_LIMIT.max, HISTORY_LIMIT.max),
          description: `list: at most this many sessions (default ${SESSION_LIST_LIMIT.default}); search: max hits (default ${DEFAULT_SEARCH_LIMIT}); history: this many messages (default ${HISTORY_LIMIT.default})`,
        }),
      ),
      sessionId: Type.Optional(Type.String({ description: "history: the id of the session" })),
      around: Type.Optional(
        Type.Integer({
          minimum: 0,
          description: "history: 0-based message index to scroll around (from search results)",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const text = (value: string) => ({
        content: [{ type: "text" as const, text: value }],
        details: undefined,
      });
      const visibility = access.visibility();

      if (params.action === "peers") {
        const peers = access.peers();
        if (peers.length === 0)
          return text("No chat is paired, so there is nowhere to deliver to.");
        return text(
          peers.map((peer) => `- id: ${peer.id}\n  chat: ${peer.label} (${peer.key})`).join("\n"),
        );
      }

      const rows = await access.list();
      if (params.action === "list") {
        const shown = selectSessions(rows, visibility, {
          ...(params.kind ? { kind: params.kind } : {}),
          ...(params.peer ? { peer: params.peer } : {}),
          ...(params.search ? { search: params.search } : {}),
          ...(params.limit ? { limit: params.limit } : {}),
        });
        const note = visibility === "self" ? "\n(You can only see your own session here.)" : "";
        return text(formatSessions(shown, access.locale()) + note);
      }

      if (params.action === "search") {
        const query = (params.query ?? params.search ?? "").trim();
        if (!query) throw new Error("`query` is required for search.");
        const after = parseTimeBound(params.after);
        const before = parseTimeBound(params.before);
        // Prioritize interactive sessions before applying the scan cap so a burst of scheduled
        // runs never pushes real conversations out of the search window.
        const filtered = rows
          .filter((row) => visibility === "all" || row.isCurrent)
          .filter((row) => !params.kind || row.kind === params.kind)
          .filter((row) => !params.peer || row.peer === params.peer)
          .filter((row) => after === null || row.modified >= after);
        const candidates = [
          ...filtered.filter((row) => row.kind !== "task"),
          ...filtered.filter((row) => row.kind === "task"),
        ].slice(0, SEARCH_SCAN_LIMIT);

        const matches: SessionSearchMatch[] = [];
        for (let offset = 0; offset < candidates.length; offset += SEARCH_CONCURRENCY) {
          const batch = candidates.slice(offset, offset + SEARCH_CONCURRENCY);
          const results = await Promise.all(
            batch.map(async (row) => {
              const lines = await access.history(row.id).catch(() => [] as HistoryLine[]);
              return searchSessionHistory(row, lines, query, { after, before });
            }),
          );
          for (const hit of results) if (hit) matches.push(hit);
        }
        const ranked = rankSessionMatches(matches, params.limit ?? DEFAULT_SEARCH_LIMIT);
        const note = visibility === "self" ? "\n(You can only see your own session here.)" : "";
        return text(formatSearchMatches(ranked, access.locale()) + note);
      }

      const id = params.sessionId?.trim();
      if (!id) throw new Error("`sessionId` is required for history.");
      const own = id === access.currentId();
      const known = rows.some((row) => row.id === id);
      if (!own && (!known || visibility === "self"))
        throw new Error(`No session ${id} that you can read. List sessions to see the ids.`);
      const lines = await access.history(id);
      const limit = params.limit ?? HISTORY_LIMIT.default;
      return text(
        params.around !== undefined
          ? formatHistoryAround(lines, params.around, limit, access.locale())
          : formatHistory(lines, limit, access.locale()),
      );
    },
  });
}
