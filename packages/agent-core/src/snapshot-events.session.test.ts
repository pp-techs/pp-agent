/**
 * What the snapshots a host sends contain: one sent because a setting of the open chat changed
 * leaves the messages out (they did not change), and one for another chat carries them all.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, AgentPaths, AgentSnapshot, StoredCredential } from "@workspace/shared";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { AgentHost } from "./index.ts";

/** A model that answers every request with the same short reply. */
function modelServer(): Server {
  return createServer((request, response) => {
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
      send({ role: "assistant", content: "" });
      send({ content: "Hello there." });
      send({}, "stop");
      response.write("data: [DONE]\n\n");
      response.end();
    });
  });
}

let dir: string;
let server: Server;
let host: AgentHost;
let events: AgentEvent[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pp-agent-snapshots-"));
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
  await host.dispose();
  const { promise, resolve } = Promise.withResolvers<void>();
  server.close(() => resolve());
  await promise;
  await rm(dir, { recursive: true, force: true });
});

const fullSnapshot = async () => (await host.handle({ type: "get_snapshot" })) as AgentSnapshot;

async function until(condition: () => Promise<boolean> | boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out");
}

/** Sends a message and waits for the reply to finish. */
async function chat(): Promise<void> {
  await host.handle({ type: "prompt", text: "Hi", attachments: [] });
  await until(async () => {
    const { status, messages } = await fullSnapshot();
    return status === "idle" && messages.some((message) => message.role === "assistant");
  });
}

const snapshotsSince = (from: number) =>
  events.slice(from).flatMap((event) => (event.type === "snapshot" ? [event.snapshot] : []));

test("a snapshot sent for a setting of the open chat leaves the messages out", async () => {
  await chat();
  expect((await fullSnapshot()).messages.length).toBeGreaterThanOrEqual(2);

  const from = events.length;
  await host.handle({ type: "set_conversation_yolo", active: true });
  await host.handle({ type: "set_thinking_level", level: "off" });

  const sent = snapshotsSince(from);
  expect(sent.length).toBeGreaterThanOrEqual(2);
  for (const snapshot of sent) {
    expect(snapshot.messagesUnchanged).toBe(true);
    expect(snapshot.messages).toEqual([]);
  }
  // The setting itself is in it.
  expect(sent[0]?.yolo.active).toBe(true);
});

test("asking for the snapshot, and opening another chat, send every message", async () => {
  await chat();
  const full = await fullSnapshot();
  expect(full.messagesUnchanged).toBeUndefined();
  expect(full.messages.length).toBeGreaterThanOrEqual(2);

  const from = events.length;
  await host.handle({ type: "new_chat" });
  const opened = snapshotsSince(from);
  expect(opened.length).toBeGreaterThan(0);
  expect(opened.every((snapshot) => snapshot.messagesUnchanged === undefined)).toBe(true);
});
