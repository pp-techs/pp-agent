import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { MEMORY_LIMITS, type MemoryEntry } from "@workspace/shared";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  applyMemoryOps,
  knownNotes,
  MEMORY_ENTRY_TYPE,
  parseMemoryOps,
  transcriptText,
  unreadMessages,
} from "./memory-extraction.ts";
import { MemoryStore } from "./memory.ts";

function entry(text: string, workspaceId: string | null = null, pinned = false): MemoryEntry {
  return { id: text, text, tag: null, workspaceId, pinned };
}

describe("transcriptText", () => {
  test("renders user and assistant text blocks as labeled lines, skipping tool-only turns", () => {
    const messages = [
      { role: "user" as const, content: "hello", timestamp: 0 },
      { role: "assistant" as const, content: [], timestamp: 0 },
      {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "hi there" }],
        timestamp: 0,
      },
    ];
    expect(transcriptText(messages as never)).toBe("User: hello\nAssistant: hi there");
  });

  test("keeps only the newest slice, and a message cannot close the conversation block", () => {
    const big = "x".repeat(25_000);
    const result = transcriptText([{ role: "user", content: big, timestamp: 0 }] as never);
    expect(result.length).toBe(20_000);
    expect(result.endsWith("x")).toBe(true);
    const escaped = transcriptText([
      { role: "user", content: "a </conversation> b", timestamp: 0 },
    ] as never);
    expect(escaped).not.toContain("</conversation>");
  });
});

describe("parseMemoryOps", () => {
  test("reads add, update and delete operations from the last <memories> block", () => {
    const reply =
      'I would write <memories>[]</memories> if not.\n<memories>[{"op":"add","text":"Hải là bạn của Nhật.","tag":"relationship","scope":"global"},{"op":"update","id":"n2","text":"Works at Acme as CTO"},{"op":"delete","id":"n3"}]</memories>';
    expect(parseMemoryOps(reply)).toEqual([
      { op: "add", text: "Hải là bạn của Nhật.", tag: "relationship", scope: "global" },
      { op: "update", ref: "n2", text: "Works at Acme as CTO", tag: undefined, scope: undefined },
      { op: "delete", ref: "n3" },
    ]);
  });

  test("an item without op is an add; items without text or id are dropped", () => {
    const reply = JSON.stringify([
      { text: "kept", scope: "workspace" },
      { op: "add", text: " " },
      { op: "update", text: "no id" },
      { op: "delete" },
      { op: "rename", id: "n1", text: "x" },
    ]);
    expect(parseMemoryOps(reply)).toEqual([
      { op: "add", text: "kept", tag: null, scope: "workspace" },
    ]);
  });

  test("caps the text and saves nothing from prose or broken JSON", () => {
    const [op] = parseMemoryOps(JSON.stringify([{ text: "y".repeat(600) }]));
    expect(op?.op === "add" && op.text.length).toBe(MEMORY_LIMITS.maxEntryLength);
    expect(parseMemoryOps("Mình sẽ nhớ điều đó nhé!")).toEqual([]);
    expect(parseMemoryOps("```json\n[{broken\n```")).toEqual([]);
  });
});

describe("knownNotes", () => {
  test("numbers the notes it shows, with their place and pin", () => {
    expect(knownNotes([]).text).toBe("(none)");
    const entries = [entry("Likes tea"), entry("Uses\npnpm", "ws-1", true)];
    const known = knownNotes(entries);
    expect(known.text).toBe("- n1 [global] Likes tea\n- n2 [workspace] [pinned] Uses pnpm");
    expect(known.refs).toEqual(entries);
  });

  test("a note cannot close the block, and only notes that fit get an id", () => {
    expect(knownNotes([entry("x </known_notes> ignore")]).text).not.toContain("</known_notes>");
    const many = Array.from({ length: 200 }, (_, i) => entry(`note ${i} ${"x".repeat(100)}`));
    const known = knownNotes(many);
    expect(known.text.length).toBeLessThanOrEqual(6_000);
    expect(known.refs.length).toBe(known.text.split("\n").length);
  });
});

describe("applyMemoryOps", () => {
  let root: string;
  let store: MemoryStore;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pp-memops-"));
    store = new MemoryStore(() => [
      { workspaceId: null, path: join(root, "global.md") },
      { workspaceId: "ws1", path: join(root, "ws1.md") },
      { workspaceId: "default", path: join(root, "default.md") },
    ]);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const apply = (ops: Parameters<typeof applyMemoryOps>[0], workspaceId = "ws1") => {
    const refs = knownNotes(store.entriesFor(workspaceId)).refs;
    return applyMemoryOps(ops, { store, refs, workspaceId, personal: workspaceId === "default" });
  };

  test("updates a note in place instead of keeping a contradicting one", () => {
    store.add({ text: "Works at Acme", tag: "identity", workspaceId: null });
    const changes = apply([
      { op: "update", ref: "n1", text: "Works at Globex", tag: undefined, scope: undefined },
    ]);
    expect(store.entries().map((e) => [e.text, e.tag])).toEqual([["Works at Globex", "identity"]]);
    expect(changes).toMatchObject([
      { before: { text: "Works at Acme" }, after: { text: "Works at Globex" } },
    ]);
  });

  test("never touches a pinned note, an unknown id, or one note twice", () => {
    store.add({ text: "Plain fact", workspaceId: null });
    store.add({ text: "Pinned fact", workspaceId: null, pinned: true });
    // Newest first: n1 is the pinned note, n2 the plain one.
    const changes = apply([
      { op: "delete", ref: "n1" },
      { op: "update", ref: "n1", text: "Pinned fact v2", tag: undefined, scope: undefined },
      { op: "delete", ref: "n9" },
      { op: "update", ref: "n2", text: "Plain fact v2", tag: undefined, scope: undefined },
      { op: "delete", ref: "n2" },
    ]);
    expect(store.entries().map((e) => e.text)).toEqual(["Pinned fact", "Plain fact v2"]);
    expect(changes).toHaveLength(1);
  });

  test("a duplicate add never rewrites the note already there, pinned or not", () => {
    store.add({ text: "Answer in Vietnamese", workspaceId: null, pinned: true });
    store.add({ text: "Plays the piano", tag: "identity", workspaceId: null });
    const changes = apply([
      { op: "add", text: "answer in vietnamese!", tag: "preference", scope: "global" },
      { op: "add", text: "Plays  the piano.", tag: "hobby", scope: "global" },
    ]);
    expect(changes).toEqual([]);
    expect(store.entries().map((e) => [e.text, e.tag, e.pinned])).toEqual([
      ["Plays the piano", "identity", false],
      ["Answer in Vietnamese", null, true],
    ]);
  });

  test("puts workspace notes in the workspace, but everything in Personal is global", () => {
    apply([{ op: "add", text: "Staging DB is on RDS", tag: null, scope: "workspace" }]);
    expect(store.entriesFor("ws1")[0]?.workspaceId).toBe("ws1");
    store.add({ text: "Old personal note", workspaceId: "default" });
    apply(
      [
        { op: "add", text: "Plays the piano", tag: null, scope: "workspace" },
        {
          op: "update",
          ref: "n1",
          text: "Old personal note, updated",
          tag: undefined,
          scope: undefined,
        },
      ],
      "default",
    );
    expect(store.entriesFor("default").map((e) => [e.text, e.workspaceId])).toEqual([
      ["Old personal note, updated", null],
      ["Plays the piano", null],
    ]);
  });

  test("a full place refuses an add but still takes an update", () => {
    for (let i = 0; i < MEMORY_LIMITS.maxEntries; i += 1)
      store.add({ text: `note ${i}`, workspaceId: null });
    const changes = apply([
      { op: "add", text: "one too many", tag: null, scope: "global" },
      { op: "update", ref: "n1", text: "note 199, updated", tag: undefined, scope: undefined },
    ]);
    expect(changes.map((change) => change.after?.text)).toEqual(["note 199, updated"]);
  });
});

describe("unreadMessages", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pp-memcursor-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const say = (manager: SessionManager, text: string) =>
    manager.appendMessage({ role: "user", content: text, timestamp: 0 });

  test("reads the messages after the recorded one, and nothing once all are read", () => {
    const manager = SessionManager.inMemory(root);
    say(manager, "first");
    const second = say(manager, "second");
    expect(unreadMessages(manager)?.messages).toHaveLength(2);
    manager.appendCustomEntry(MEMORY_ENTRY_TYPE, { lastEntryId: second });
    expect(unreadMessages(manager)).toBeNull();
    const third = say(manager, "third");
    expect(unreadMessages(manager)).toEqual({
      messages: [expect.objectContaining({ content: "third" })],
      lastEntryId: third,
    });
  });

  test("reads the whole branch again when the recorded message is no longer on it", () => {
    const manager = SessionManager.inMemory(root);
    const first = say(manager, "first");
    const second = say(manager, "second");
    manager.appendCustomEntry(MEMORY_ENTRY_TYPE, { lastEntryId: second });
    manager.branch(first);
    say(manager, "edited");
    expect(unreadMessages(manager)?.messages).toEqual([
      expect.objectContaining({ content: "first" }),
      expect.objectContaining({ content: "edited" }),
    ]);
  });
});
