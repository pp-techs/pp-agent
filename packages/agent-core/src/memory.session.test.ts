/**
 * Long-term memory inside a real host (scripted OpenAI-style model): the background pass runs
 * once a window conversation has been idle, reads only what it has not read before, announces
 * what it changed so it can be undone, and never changes the open conversation's prompt.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type {
  AgentEvent,
  AgentPaths,
  AgentSnapshot,
  MemoryView,
  StoredCredential,
} from "@workspace/shared";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { AgentHost } from "./index.ts";
import { ORIGIN_ENTRY_TYPE } from "./memory-extraction.ts";

/** Replies of the background memory pass, in order; then "nothing to keep". */
let memoryReplies: string[];
/** Bodies of the memory pass requests. */
let memoryRequests: string[];
/** Memory pass requests to answer with a server error. */
let memoryFailures: number;
/** Memory pass requests to cut short at the token limit. */
let memoryTruncated: number;
/** Memory pass requests to answer with no text at all. */
let memoryEmpty: number;
/** When true, the next chat request is answered only once the test releases it. */
let holdChat: boolean;
/** Completes the held chat request; null while none is held. */
let releaseChat: (() => void) | null;
/** When true, the next memory pass request is answered only once the test releases it. */
let holdMemory: boolean;
/** Completes the held memory pass request; null while none is held. */
let releaseMemory: (() => void) | null;
/** Id of the fake gateway, so a seeded session can name its model. */
let gatewayId: string;
/** Failed memory passes, counted from the error each one logs (the observable failure signal). */
let extractionFailures: number;
let originalError: typeof console.error;
/** System prompts of the conversation's own requests. */
let chatSystems: string[];
let events: AgentEvent[];
let dir: string;
let server: Server;
let host: AgentHost;

function modelServer(): Server {
  return createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      const body = JSON.parse(raw) as { messages: { role: string; content: unknown }[] };
      const respond = (text: string, cut = false) => {
        response.writeHead(200, { "content-type": "text/event-stream" });
        const steps: [object, string | null][] = cut
          ? [[{ role: "assistant", content: text }, "length"]]
          : [
              [{ role: "assistant", content: text }, null],
              [{}, "stop"],
            ];
        for (const [delta, finish] of steps)
          response.write(
            `data: ${JSON.stringify({
              id: "chatcmpl-1",
              object: "chat.completion.chunk",
              created: 0,
              model: "fake",
              choices: [{ index: 0, delta, finish_reason: finish }],
            })}\n\n`,
          );
        response.write("data: [DONE]\n\n");
        response.end();
      };
      let reply = "ok";
      let truncated = false;
      if (/lasting facts/.test(raw)) {
        memoryRequests.push(raw);
        if (memoryFailures > 0) {
          memoryFailures -= 1;
          // The connection drops mid-reply: the run settles with an error reply instead of
          // rejecting, the case where a partial reply could be mistaken for an answer.
          response.writeHead(200, { "content-type": "text/event-stream" });
          response.write(
            `data: ${JSON.stringify({
              id: "chatcmpl-1",
              object: "chat.completion.chunk",
              created: 0,
              model: "fake",
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant", content: "partial notes, never finished" },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
          );
          response.destroy();
          return;
        }
        reply = memoryReplies.shift() ?? "<memories>[]</memories>";
        if (memoryEmpty > 0) {
          memoryEmpty -= 1;
          // The model completed with no text at all.
          reply = "";
        }
        if (memoryTruncated > 0) {
          memoryTruncated -= 1;
          // The model hit its output limit mid-reply: the JSON is cut in half.
          reply = '<memories>[{"op":"add","text":"half';
          truncated = true;
        }
        if (holdMemory) {
          holdMemory = false;
          const held = reply;
          const cut = truncated;
          releaseMemory = () => respond(held, cut);
          return;
        }
      } else if (/short title for it/.test(raw)) {
        reply = "<title>Test</title>";
      } else {
        chatSystems.push(
          body.messages
            .filter((m) => m.role === "system")
            .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
            .join("\n"),
        );
        if (holdChat) {
          holdChat = false;
          releaseChat = () => respond("ok");
          return;
        }
      }
      respond(reply, truncated);
    });
  });
}

beforeEach(async () => {
  process.env.PP_AGENT_MEMORY_IDLE_MS = "100";
  dir = await mkdtemp(join(tmpdir(), "pp-agent-memory-"));
  memoryReplies = [];
  memoryRequests = [];
  memoryFailures = 0;
  memoryTruncated = 0;
  memoryEmpty = 0;
  holdChat = false;
  releaseChat = null;
  holdMemory = false;
  releaseMemory = null;
  extractionFailures = 0;
  originalError = console.error;
  console.error = (...args: unknown[]) => {
    if (String(args[0]).includes("Background memory extraction failed")) extractionFailures += 1;
    originalError(...args);
  };
  chatSystems = [];
  events = [];
  server = modelServer();
  const store = new Map<string, StoredCredential>();
  host = new AgentHost({
    output: { emit: (event: AgentEvent) => void events.push(event), openUrl: () => undefined },
    vault: {
      read: async (id) => store.get(id) ?? null,
      list: async () => [...store.keys()],
      write: async (id, credential) => void store.set(id, credential),
      delete: async (id) => void store.delete(id),
      available: async () => true,
    },
    service: {
      status: async () => {
        throw new Error("unused");
      },
      install: async () => undefined,
      uninstall: async () => undefined,
    },
  });
  const paths: AgentPaths = {
    workspaceDir: join(dir, "workspace"),
    agentDir: join(dir, "agent"),
    sessionDir: join(dir, "sessions"),
    settingsFile: join(dir, "settings.json"),
  };
  await host.init(paths, "en-US");
  const { promise, resolve } = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", resolve);
  await promise;
  const saved = (await host.handle({
    type: "save_gateway",
    gateway: {
      name: "Fake",
      api: "openai-completions",
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
      models: [{ id: "fake", images: false }],
      requiresApiKey: false,
    },
  })) as { id: string };
  gatewayId = saved.id;
  await host.handle({ type: "new_chat" });
});

afterEach(async () => {
  delete process.env.PP_AGENT_MEMORY_IDLE_MS;
  console.error = originalError;
  await host.dispose();
  const { promise, resolve } = Promise.withResolvers<void>();
  server.close(() => resolve());
  await promise;
  await rm(dir, { recursive: true, force: true });
});

/**
 * Polls `condition`: the host talks to a real HTTP model server and the memory timer is real
 * (shortened by `PP_AGENT_MEMORY_IDLE_MS`), so fake timers cannot drive it.
 */
async function until(condition: () => Promise<boolean> | boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await condition()) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 25);
    await promise;
  }
  throw new Error("timed out");
}

async function say(text: string): Promise<void> {
  const before = chatSystems.length;
  await host.handle({ type: "prompt", text, attachments: [] });
  await until(
    async () =>
      chatSystems.length > before &&
      ((await host.handle({ type: "get_snapshot" })) as AgentSnapshot).status === "idle",
  );
}

const notes = async () => ((await host.handle({ type: "get_memory" })) as MemoryView).entries;

test("the idle pass reads each message once, announces its changes, and they can be undone", async () => {
  memoryReplies.push(
    '<memories>[{"op":"add","text":"Works at Acme as a developer","tag":"identity","scope":"workspace"}]</memories>',
  );
  await say("I am Nhat, zebra-42, I work at Acme as a developer.");
  await until(() => events.some((event) => event.type === "memory_auto_saved"));
  expect(memoryRequests).toHaveLength(1);
  expect(memoryRequests[0]).toContain("zebra-42");
  // The built-in Personal workspace keeps every extracted note global.
  expect(await notes()).toMatchObject([
    { text: "Works at Acme as a developer", workspaceId: null },
  ]);

  await say("thanks, that helps a lot with the project today");
  await until(() => memoryRequests.length === 2);
  expect(memoryRequests[1]).toContain("User: thanks, that helps");
  expect(memoryRequests[1]).not.toContain("zebra-42");
  // The open conversation's prompt did not pick up the new note.
  expect(chatSystems).toHaveLength(2);
  expect(chatSystems[1]).toBe(chatSystems[0]);
  expect(chatSystems[1]).not.toContain("Works at Acme");

  const saved = events.find((event) => event.type === "memory_auto_saved");
  if (saved?.type !== "memory_auto_saved") throw new Error("no memory_auto_saved event");
  expect(await host.handle({ type: "undo_memory_pass", passId: saved.passId })).toEqual({
    undone: 1,
  });
  expect(await notes()).toEqual([]);
});

test("a failed pass keeps its messages for the next one instead of skipping them", async () => {
  // The call retries once; both attempts drop mid-reply, so the pass settles with no answer.
  memoryFailures = 2;
  await say("I am Nhat, zebra-42, and this detail must not be lost.");
  await until(() => memoryRequests.length === 2);
  // Request arrival is not pass completion: wait for the pass to give up before the next turn,
  // or its in-flight entry would skip the next pass and leave this test waiting forever.
  await until(() => extractionFailures === 1);
  expect(await notes()).toEqual([]);
  expect(events.some((event) => event.type === "memory_auto_saved")).toBe(false);

  memoryReplies.push(
    '<memories>[{"op":"add","text":"Kept after a failed pass","tag":null,"scope":"global"}]</memories>',
  );
  await say("and one more thing worth noting today");
  await until(() => memoryRequests.length === 3);
  // The failed pass left no cursor: its message is read again, not skipped.
  expect(memoryRequests[2]).toContain("zebra-42");
  await until(() => events.some((event) => event.type === "memory_auto_saved"));
  expect(await notes()).toMatchObject([{ text: "Kept after a failed pass" }]);
});

test("a reply cut short by the token limit is not read as an answer", async () => {
  memoryTruncated = 1;
  await say("I am Nhat, zebra-42, and this detail must not be lost.");
  await until(() => memoryRequests.length === 1);
  await until(() => extractionFailures === 1);
  await say("and one more thing worth noting today");
  await until(() => memoryRequests.length === 2);
  // The half-finished JSON saved nothing and left no cursor: the message is read again.
  expect(memoryRequests[1]).toContain("zebra-42");
});

test("an empty reply is not read as an answer", async () => {
  memoryEmpty = 1;
  await say("I am Nhat, zebra-42, and this detail must not be lost.");
  await until(() => memoryRequests.length === 1);
  await until(() => extractionFailures === 1);
  await say("and one more thing worth noting today");
  await until(() => memoryRequests.length === 2);
  // The empty reply is not the contract's `<memories>[]</memories>`: the message is read again.
  expect(memoryRequests[1]).toContain("zebra-42");
});

test("deleting a conversation does not run its memory pass", async () => {
  // The idle timer is held far off: only closing the conversation could run the pass now.
  process.env.PP_AGENT_MEMORY_IDLE_MS = "60000";
  await say("I am Nhat, zebra-42, in a chat I am about to delete");
  const snapshot = (await host.handle({ type: "get_snapshot" })) as AgentSnapshot;
  if (!snapshot.sessionPath) throw new Error("no open session");
  await host.handle({ type: "delete_session", path: snapshot.sessionPath });

  process.env.PP_AGENT_MEMORY_IDLE_MS = "100";
  memoryReplies.push(
    '<memories>[{"op":"add","text":"From the fresh conversation","tag":null,"scope":"global"}]</memories>',
  );
  await say("a fresh marker worth noting today");
  await until(() => events.some((event) => event.type === "memory_auto_saved"));
  // The only pass is the fresh conversation's; the deleted one left no request and no note.
  expect(memoryRequests).toHaveLength(1);
  expect(memoryRequests[0]).not.toContain("zebra-42");
  expect((await notes()).map((note) => note.text)).toEqual(["From the fresh conversation"]);
});

test("deleting a conversation that is still answering never extracts it", async () => {
  process.env.PP_AGENT_MEMORY_IDLE_MS = "60000";
  holdChat = true;
  await host.handle({
    type: "prompt",
    text: "I am Nhat, zebra-42, in a busy chat",
    attachments: [],
  });
  await until(() => releaseChat !== null);
  const snapshot = (await host.handle({ type: "get_snapshot" })) as AgentSnapshot;
  if (!snapshot.sessionPath) throw new Error("no open session");
  const deletion = host.handle({ type: "delete_session", path: snapshot.sessionPath });
  // The turn settles while the deletion is under way: the window where a pass could start.
  releaseChat?.();
  releaseChat = null;
  await deletion;

  process.env.PP_AGENT_MEMORY_IDLE_MS = "100";
  memoryReplies.push(
    '<memories>[{"op":"add","text":"From the fresh conversation","tag":null,"scope":"global"}]</memories>',
  );
  await say("a fresh marker worth noting today");
  await until(() => events.some((event) => event.type === "memory_auto_saved"));
  expect(memoryRequests).toHaveLength(1);
  expect(memoryRequests[0]).not.toContain("zebra-42");
  expect((await notes()).map((note) => note.text)).toEqual(["From the fresh conversation"]);
});

test("deleting a conversation drops the changes of a pass already running", async () => {
  holdMemory = true;
  memoryReplies.push(
    '<memories>[{"op":"add","text":"From a deleted conversation","tag":null,"scope":"global"}]</memories>',
  );
  await say("I am Nhat, zebra-42, in a chat I am about to delete");
  await until(() => releaseMemory !== null); // the pass is waiting on the model
  const snapshot = (await host.handle({ type: "get_snapshot" })) as AgentSnapshot;
  if (!snapshot.sessionPath) throw new Error("no open session");
  await host.handle({ type: "delete_session", path: snapshot.sessionPath });
  // The model answers after the deletion: its operations must not be applied.
  releaseMemory?.();
  releaseMemory = null;

  memoryReplies.push(
    '<memories>[{"op":"add","text":"From the fresh conversation","tag":null,"scope":"global"}]</memories>',
  );
  await say("a fresh marker worth noting today");
  await until(() => events.some((event) => event.type === "memory_auto_saved"));
  expect((await notes()).map((note) => note.text)).toEqual(["From the fresh conversation"]);
  expect(events.filter((event) => event.type === "memory_auto_saved")).toHaveLength(1);
});

test("a session created for a run is never read, even reopened in the window", async () => {
  // What runScheduledTask writes at creation; the mark outlives the task record.
  const manager = SessionManager.create(join(dir, "workspace"), join(dir, "sessions"));
  manager.appendCustomEntry(ORIGIN_ENTRY_TYPE, { kind: "task" });
  manager.appendMessage({
    role: "user",
    content: "I am Nhat, zebra-42, from a scheduled run",
    timestamp: Date.now(),
  });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "done" }],
    api: "openai-completions",
    provider: gatewayId,
    model: "fake",
    // Pi reads prior usage when it settles a run; the shape is a real assistant message's.
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  });
  manager.appendModelChange(gatewayId, "fake");
  const file = manager.getSessionFile();
  if (!file) throw new Error("no session file");
  await host.handle({ type: "open_session", path: file });
  await say("and a fresh marker worth noting today");
  await host.handle({ type: "new_chat" });

  memoryReplies.push(
    '<memories>[{"op":"add","text":"From the fresh conversation","tag":null,"scope":"global"}]</memories>',
  );
  await say("another marker worth noting today");
  await until(() => events.some((event) => event.type === "memory_auto_saved"));
  // The run's messages never reach a pass; the only request is the fresh conversation's own.
  expect(memoryRequests).toHaveLength(1);
  expect(memoryRequests[0]).not.toContain("zebra-42");
});

test("undo never overwrites a note recreated since the pass", async () => {
  await host.handle({
    type: "save_memory_entry",
    text: "Answer in Vietnamese",
    tag: "preference",
    workspaceId: null,
    pinned: false,
  });
  memoryReplies.push('<memories>[{"op":"delete","id":"n1"}]</memories>');
  await say("forget that preference please, I changed my mind");
  await until(() => events.some((event) => event.type === "memory_auto_saved"));
  const saved = events.find((event) => event.type === "memory_auto_saved");
  if (saved?.type !== "memory_auto_saved") throw new Error("no memory_auto_saved event");
  expect(await notes()).toEqual([]);

  await host.handle({
    type: "save_memory_entry",
    text: "Answer in Vietnamese",
    tag: "hobby",
    pinned: true,
  });
  // The deleted note was recreated: restoring over it would rewrite its tag and pin.
  expect(await host.handle({ type: "undo_memory_pass", passId: saved.passId })).toEqual({
    undone: 0,
  });
  expect(await notes()).toMatchObject([
    { text: "Answer in Vietnamese", tag: "hobby", pinned: true },
  ]);
});

test("a new conversation's profile carries what earlier ones saved", async () => {
  memoryReplies.push(
    '<memories>[{"op":"add","text":"Prefers short answers","tag":"preference","scope":"global"}]</memories>',
  );
  await say("Please always keep your answers short, I prefer that.");
  await until(() => events.some((event) => event.type === "memory_auto_saved"));
  await host.handle({ type: "new_chat" });
  await say("hello");
  expect(chatSystems.at(-1)).toContain("- [preference] Prefers short answers");
});
