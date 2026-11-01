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
import type {
  AgentEvent,
  AgentPaths,
  AgentSnapshot,
  MemoryView,
  StoredCredential,
} from "@workspace/shared";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { AgentHost } from "./index.ts";

/** Replies of the background memory pass, in order; then "nothing to keep". */
let memoryReplies: string[];
/** Bodies of the memory pass requests. */
let memoryRequests: string[];
/** Memory pass requests to answer with a server error. */
let memoryFailures: number;
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
      let reply = "ok";
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
      } else if (/short title for it/.test(raw)) {
        reply = "<title>Test</title>";
      } else {
        chatSystems.push(
          body.messages
            .filter((m) => m.role === "system")
            .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
            .join("\n"),
        );
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const [delta, finish] of [
        [{ role: "assistant", content: reply }, null],
        [{}, "stop"],
      ] as const)
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
    });
  });
}

beforeEach(async () => {
  process.env.PP_AGENT_MEMORY_IDLE_MS = "100";
  dir = await mkdtemp(join(tmpdir(), "pp-agent-memory-"));
  memoryReplies = [];
  memoryRequests = [];
  memoryFailures = 0;
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
  await host.handle({
    type: "save_gateway",
    gateway: {
      name: "Fake",
      api: "openai-completions",
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
      models: [{ id: "fake", images: false }],
      requiresApiKey: false,
    },
  });
  await host.handle({ type: "new_chat" });
});

afterEach(async () => {
  delete process.env.PP_AGENT_MEMORY_IDLE_MS;
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
