/**
 * Yolo mode inside a real host (scripted OpenAI-style model): the open conversation's own switch
 * skips the approval step for a tool that would otherwise ask, Settings › Tools forcing it on
 * everywhere locks the conversation's switch, and turning it off brings the ask back.
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
  ComputerRequest,
  StoredCredential,
} from "@workspace/shared";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { AgentHost } from "./index.ts";

/** A fake OpenAI-compatible chat completions server; `listen` returns its base URL. */
interface ModelServer {
  server: Server;
  listen(): Promise<string>;
}

/** Answers each request with the next scripted tool call, then with plain text. */
function modelServer(calls: Record<string, unknown>[]): ModelServer {
  const server: Server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
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
      const call = calls.shift();
      send({ role: "assistant", content: "" });
      if (call) {
        send({
          tool_calls: [
            {
              index: 0,
              id: `call-${calls.length}`,
              type: "function",
              function: { name: "computer", arguments: JSON.stringify(call) },
            },
          ],
        });
        send({}, "tool_calls");
      } else {
        send({ content: "done" });
        send({}, "stop");
      }
      response.write("data: [DONE]\n\n");
      response.end();
    });
  });
  return {
    server,
    async listen(): Promise<string> {
      const { promise, resolve } = Promise.withResolvers<void>();
      server.listen(0, "127.0.0.1", resolve);
      await promise;
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    },
  };
}

const NOTES = { id: "com.apple.Notes", name: "Notes" };
const CLICK = { action: "click", app: NOTES.id, x: 1, y: 2 };

let dir: string;
let calls: Record<string, unknown>[];
let model: ModelServer;
let host: AgentHost;
let request: ReturnType<typeof vi.fn<(request: ComputerRequest) => Promise<{ text: string }>>>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pp-agent-yolo-"));
  calls = [];
  model = modelServer(calls);
  request = vi.fn(async () => ({ text: "window" }));
  const store = new Map<string, StoredCredential>();
  host = new AgentHost({
    output: { emit: (_event: AgentEvent) => undefined, openUrl: () => undefined },
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
    computer: { available: () => true, request: (call) => request(call) },
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
  await host.handle({ type: "set_tool_policy", name: "computer", policy: "auto" });
  await host.handle({ type: "set_computer_app_access", app: NOTES, access: "allowed" });
  await host.handle({ type: "new_chat" });
});

afterEach(async () => {
  await host.dispose();
  const { promise, resolve } = Promise.withResolvers<void>();
  model.server.close(() => resolve());
  await promise;
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

test("a write action asks until the conversation's own yolo switch is on", async () => {
  expect((await snapshot()).yolo).toEqual({ active: false, source: "conversation" });

  calls.push(CLICK);
  await host.handle({ type: "prompt", text: "click in notes", attachments: [] });
  await until(async () => (await snapshot()).approvals.length > 0);
  const pending = (await snapshot()).approvals[0]!;
  await host.handle({ type: "respond_approval", requestId: pending.requestId, approved: true });
  await until(async () => (await snapshot()).status === "idle");
  expect(request).toHaveBeenCalledTimes(1);

  await host.handle({ type: "set_conversation_yolo", active: true });
  expect((await snapshot()).yolo).toEqual({ active: true, source: "conversation" });

  calls.push(CLICK);
  await host.handle({ type: "prompt", text: "click in notes again", attachments: [] });
  await until(() => request.mock.calls.length === 2);
  await until(async () => (await snapshot()).status === "idle");
  expect((await snapshot()).approvals).toHaveLength(0);

  await host.handle({ type: "set_conversation_yolo", active: false });
  calls.push(CLICK);
  await host.handle({ type: "prompt", text: "click in notes once more", attachments: [] });
  await until(async () => (await snapshot()).approvals.length > 0);
  expect(request).toHaveBeenCalledTimes(2);
});

test("Settings forcing yolo on everywhere locks the conversation's own switch", async () => {
  await host.handle({ type: "update_settings", patch: { yoloMode: true } });
  expect((await snapshot()).yolo).toEqual({ active: true, source: "settings" });

  await expect(host.handle({ type: "set_conversation_yolo", active: false })).rejects.toThrow();

  calls.push(CLICK);
  await host.handle({ type: "prompt", text: "click in notes", attachments: [] });
  await until(() => request.mock.calls.length === 1);
  await until(async () => (await snapshot()).status === "idle");
  expect((await snapshot()).approvals).toHaveLength(0);
});

test("Settings forcing yolo on everywhere also skips a new app's first-use card", async () => {
  const FINDER = { id: "com.apple.finder", name: "Finder" };
  await host.handle({ type: "update_settings", patch: { yoloMode: true } });

  calls.push({ action: "click", app: FINDER.id, x: 1, y: 2 });
  await host.handle({ type: "prompt", text: "click in finder", attachments: [] });
  await until(() => request.mock.calls.length === 1);
  await until(async () => (await snapshot()).status === "idle");
  expect((await snapshot()).approvals).toHaveLength(0);
});

test("yolo also skips an app's first-use card, and remembers it allowed for the chat", async () => {
  const FINDER = { id: "com.apple.finder", name: "Finder" };
  await host.handle({ type: "set_conversation_yolo", active: true });

  calls.push({ action: "click", app: FINDER.id, x: 1, y: 2 });
  await host.handle({ type: "prompt", text: "click in finder", attachments: [] });
  await until(() => request.mock.calls.length === 1);
  await until(async () => (await snapshot()).status === "idle");
  expect((await snapshot()).approvals).toHaveLength(0);

  // The app itself stays allowed for the rest of the chat once yolo turns back off; the click
  // still asks on its own, since that is the tool's policy, not the app's.
  await host.handle({ type: "set_conversation_yolo", active: false });
  calls.push({ action: "click", app: FINDER.id, x: 3, y: 4 });
  await host.handle({ type: "prompt", text: "click in finder again", attachments: [] });
  await until(async () => (await snapshot()).approvals.length > 0);
  const pending = (await snapshot()).approvals[0]!;
  expect(pending.app).toBeUndefined();
  await host.handle({ type: "respond_approval", requestId: pending.requestId, approved: true });
  await until(() => request.mock.calls.length === 2);
});

test("yolo does not open a protected app", async () => {
  const TERMINAL = { id: "com.apple.terminal", name: "Terminal" };
  await host.handle({ type: "set_conversation_yolo", active: true });

  calls.push({ action: "click", app: TERMINAL.id, x: 1, y: 2 });
  await host.handle({ type: "prompt", text: "click in terminal", attachments: [] });
  await until(async () => (await snapshot()).status === "idle");
  expect(request).not.toHaveBeenCalled();
});
