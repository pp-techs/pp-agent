import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, AgentPaths, AgentSnapshot, StoredCredential } from "@workspace/shared";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { AgentHost } from "./index.ts";

/**
 * A model endpoint that answers `reply <message>` to each user message, once `release(message)`
 * lets that message through (at once when it was released before it arrived).
 */
function modelServer() {
  const gates = new Map<string, PromiseWithResolvers<void>>();
  const gate = (message: string) => {
    let entry = gates.get(message);
    if (!entry) {
      entry = Promise.withResolvers<void>();
      gates.set(message, entry);
    }
    return entry;
  };
  const server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      void (async () => {
        const messages = (JSON.parse(body) as { messages: { role: string; content: unknown }[] })
          .messages;
        const last = messages.filter((message) => message.role === "user").at(-1)?.content;
        const text = typeof last === "string" ? last : JSON.stringify(last);
        const message = /hold-[a-z]+/.exec(text)?.[0] ?? text;
        // The background title and memory passes answer at once with nothing usable; only the
        // chat is gated.
        const background = messages.some(
          (m) =>
            m.role === "system" &&
            /short title for it|lasting facts/.test(JSON.stringify(m.content)),
        );
        response.writeHead(200, { "content-type": "text/event-stream" });
        const send = (delta: object, finish: string | null = null) =>
          response.write(
            `data: ${JSON.stringify({
              id: "chatcmpl-1",
              object: "chat.completion.chunk",
              created: 0,
              model: "fake",
              choices: [{ index: 0, delta, finish_reason: finish }],
            })}\n\n`,
          );
        send({ role: "assistant", content: "" });
        if (!background) await gate(message).promise;
        send({ content: background ? "" : `reply ${message}` });
        send({}, "stop");
        response.write("data: [DONE]\n\n");
        response.end();
      })();
    });
  });
  return {
    server,
    release: (message: string) => gate(message).resolve(),
    async listen(): Promise<string> {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    },
  };
}

let dir: string;
let model: ReturnType<typeof modelServer>;
let host: AgentHost;
let events: AgentEvent[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pp-agent-conversations-"));
  model = modelServer();
  events = [];
  const store = new Map<string, StoredCredential>();
  host = new AgentHost({
    output: { emit: (event) => events.push(event), openUrl: () => undefined },
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
  await host.handle({
    type: "save_gateway",
    gateway: {
      name: "Fake",
      api: "openai-completions",
      baseUrl: await model.listen(),
      models: [{ id: "fake", images: false }],
      requiresApiKey: false,
    },
  });
  // The conversation open since the start predates the gateway; open one that uses it.
  await host.handle({ type: "new_chat" });
});

afterEach(async () => {
  await host.dispose();
  await new Promise((resolve) => model.server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

const snapshot = async () => (await host.handle({ type: "get_snapshot" })) as AgentSnapshot;

async function until(condition: () => Promise<boolean> | boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out");
}

const texts = (state: AgentSnapshot) =>
  state.messages.flatMap((message) =>
    message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])),
  );

test("a conversation keeps answering while another one is opened and used", async () => {
  const first = (await snapshot()).sessionPath;
  await host.handle({ type: "prompt", text: "hold-a", attachments: [] });
  await until(async () => (await snapshot()).status === "running");

  // Moving on does not stop the answer.
  await host.handle({ type: "new_chat" });
  const second = await snapshot();
  expect(second.sessionPath).not.toBe(first);
  expect(second.status).toBe("idle");
  expect(second.messages).toEqual([]);
  expect(second.activity.running).toEqual([first]);

  // The second conversation answers while the first is still waiting on the model.
  model.release("hold-b");
  await host.handle({ type: "prompt", text: "hold-b", attachments: [] });
  await until(async () => texts(await snapshot()).includes("reply hold-b"));
  expect((await snapshot()).activity.running).toEqual([first]);

  // The first one finishes in the background without touching what the window shows.
  const shown = events.length;
  model.release("hold-a");
  await until(async () => (await snapshot()).activity.running.length === 0);
  expect(texts(await snapshot())).toContain("reply hold-b");
  expect(texts(await snapshot())).not.toContain("reply hold-a");
  expect(events.slice(shown).some((event) => event.type === "message")).toBe(false);

  // Opening it shows the whole answer.
  await host.handle({ type: "open_session", path: first as string });
  const reopened = await snapshot();
  expect(reopened.sessionPath).toBe(first);
  expect(texts(reopened)).toEqual(["hold-a", "reply hold-a"]);
});

test("opening a conversation that is still answering brings it back live", async () => {
  const first = (await snapshot()).sessionPath as string;
  await host.handle({ type: "prompt", text: "hold-c", attachments: [] });
  await until(async () => (await snapshot()).status === "running");
  await host.handle({ type: "new_chat" });

  await host.handle({ type: "open_session", path: first });
  const back = await snapshot();
  expect(back.sessionPath).toBe(first);
  expect(back.status).toBe("running");

  model.release("hold-c");
  await until(async () => texts(await snapshot()).includes("reply hold-c"));
  await until(async () => (await snapshot()).status === "idle");
});

test("deleting a conversation that is answering in the background stops it", async () => {
  const first = (await snapshot()).sessionPath as string;
  await host.handle({ type: "prompt", text: "hold-d", attachments: [] });
  await until(async () => (await snapshot()).status === "running");
  await host.handle({ type: "new_chat" });
  expect((await snapshot()).activity.running).toEqual([first]);

  await host.handle({ type: "delete_session", path: first });
  expect((await snapshot()).activity.running).toEqual([]);
});

test("a new chat is listed as soon as its first message is sent, and the list is told", async () => {
  const first = (await snapshot()).sessionPath as string;
  const before = events.length;
  await host.handle({ type: "prompt", text: "hold-e", attachments: [] });
  await until(async () => (await snapshot()).status === "running");
  expect(events.slice(before).some((event) => event.type === "sessions_changed")).toBe(true);

  // Moved to the background, its reply not yet written to disk.
  await host.handle({ type: "new_chat" });
  const rows = (await host.handle({ type: "list_sessions" })) as { path: string; title: string }[];
  expect(rows.find((row) => row.path === first)?.title).toBe("hold-e");

  model.release("hold-e");
  await until(async () => (await snapshot()).activity.running.length === 0);
  const after = (await host.handle({ type: "list_sessions" })) as { path: string }[];
  expect(after.filter((row) => row.path === first)).toHaveLength(1);
});

test("clearing a workspace's sessions removes only its own, pinned or running", async () => {
  const extra = await mkdtemp(join(tmpdir(), "pp-agent-workspace-"));
  const workspace = await host.handle({
    type: "save_workspace",
    workspace: { name: "Extra", icon: "📁", dir: extra, agentId: null },
  });
  const { id: workspaceId } = workspace as { id: string };

  // One session in the default workspace, kept as a control.
  const kept = (await snapshot()).sessionPath as string;
  await host.handle({ type: "prompt", text: "hold-f", attachments: [] });
  await until(async () => (await snapshot()).status === "running");
  model.release("hold-f");
  await until(async () => (await snapshot()).activity.running.length === 0);
  await host.handle({ type: "pin_session", path: kept, pinned: true });

  // Two sessions in the new workspace: one finished, one still answering in the background.
  await host.handle({ type: "new_chat", workspaceId });
  const finished = (await snapshot()).sessionPath as string;
  await host.handle({ type: "prompt", text: "hold-g", attachments: [] });
  await until(async () => (await snapshot()).status === "running");
  model.release("hold-g");
  await until(async () => (await snapshot()).activity.running.length === 0);

  await host.handle({ type: "new_chat", workspaceId });
  const running = (await snapshot()).sessionPath as string;
  await host.handle({ type: "prompt", text: "hold-h", attachments: [] });
  await until(async () => (await snapshot()).status === "running");
  await host.handle({ type: "new_chat" });
  expect((await snapshot()).activity.running).toEqual([running]);

  await host.handle({ type: "clear_sessions", workspaceId });

  const rows = (await host.handle({ type: "list_sessions" })) as { path: string }[];
  expect(rows.some((row) => row.path === kept)).toBe(true);
  expect(rows.some((row) => row.path === finished)).toBe(false);
  expect(rows.some((row) => row.path === running)).toBe(false);
  expect((await snapshot()).activity.running).toEqual([]);

  await rm(extra, { recursive: true, force: true });
});
