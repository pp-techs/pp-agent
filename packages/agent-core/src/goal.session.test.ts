/**
 * Goals inside a real host (scripted OpenAI-style model): a goal makes the agent carry on turn
 * after turn until it calls `complete_goal`, a turn that only answers waits for the person, and
 * the tool exists only while the goal is active.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, AgentPaths, AgentSnapshot, StoredCredential } from "@workspace/shared";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { AgentHost } from "./index.ts";

/** One scripted model reply: a tool call, or plain text. */
type Step = { tool: string; args: Record<string, unknown> } | { text: string };

interface Request {
  tools: string[];
  system: string;
  /** Text of every message the model was sent, in order. */
  messages: string[];
}

/** Answers each request with the next scripted step, then with "ok"; records what it was sent. */
function modelServer(script: Step[], requests: Request[]): Server {
  return createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        tools?: { function: { name: string } }[];
        messages: { role: string; content: unknown }[];
      };
      const text = (content: unknown) =>
        typeof content === "string" ? content : JSON.stringify(content);
      // The background title and memory passes are not part of the conversation being scripted.
      const background = /short title for it|lasting facts/.test(JSON.stringify(body.messages));
      if (!background)
        requests.push({
          tools: (body.tools ?? []).map((tool) => tool.function.name),
          system: body.messages
            .filter((m) => m.role === "system")
            .map((m) => text(m.content))
            .join("\n"),
          messages: body.messages.filter((m) => m.role !== "system").map((m) => text(m.content)),
        });
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
      const step = (background ? undefined : script.shift()) ?? { text: background ? "[]" : "ok" };
      send({ role: "assistant", content: "" });
      if ("tool" in step) {
        send({
          tool_calls: [
            {
              index: 0,
              id: `call-${requests.length}`,
              type: "function",
              function: { name: step.tool, arguments: JSON.stringify(step.args) },
            },
          ],
        });
        send({}, "tool_calls");
      } else {
        send({ content: step.text });
        send({}, "stop");
      }
      response.write("data: [DONE]\n\n");
      response.end();
    });
  });
}

let dir: string;
let script: Step[];
let requests: Request[];
let server: Server;
let host: AgentHost;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pp-agent-goal-"));
  script = [];
  requests = [];
  server = modelServer(script, requests);
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

const snapshot = async () => (await host.handle({ type: "get_snapshot" })) as AgentSnapshot;

async function until(condition: () => Promise<boolean> | boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out");
}

/** Waits for the conversation to be idle and quiet (a follow-up turn would have started by now). */
async function settled(): Promise<void> {
  await until(async () => (await snapshot()).status === "idle");
  await new Promise((resolve) => setTimeout(resolve, 150));
  await until(async () => (await snapshot()).status === "idle");
}

test("the agent keeps working turn after turn until it calls complete_goal", async () => {
  script.push(
    { tool: "current_datetime", args: {} },
    { text: "Made some progress." },
    { tool: "complete_goal", args: { summary: "Checked the time." } },
    { text: "The goal is done." },
  );
  await host.handle({ type: "set_goal", action: "start", objective: "Find out what time it is" });
  expect((await snapshot()).goal).toEqual({
    objective: "Find out what time it is",
    status: "active",
    waiting: false,
  });
  await until(async () => (await snapshot()).goal === null);
  await settled();

  expect(requests).toHaveLength(4);
  // Only while the goal is active: its prompt section and the tool that ends it.
  for (const request of requests) {
    expect(request.tools).toContain("complete_goal");
    expect(request.system).toContain("Find out what time it is");
  }
  // The second turn started by itself, with a message the chat does not show.
  expect(requests[2]!.messages.join("\n")).toContain("Continue working toward the goal");
  const visible = (await snapshot()).messages.filter((message) => message.role === "user");
  expect(visible).toHaveLength(1);

  // Once done, the next message gets neither.
  await host.handle({ type: "prompt", text: "thanks", attachments: [] });
  await settled();
  expect(requests).toHaveLength(5);
  expect(requests[4]!.tools).not.toContain("complete_goal");
  expect(requests[4]!.system).not.toContain("Find out what time it is");
});

test("a turn that only answers waits for the person instead of carrying on", async () => {
  script.push({ text: "Which folder do you mean?" });
  await host.handle({ type: "set_goal", action: "start", objective: "Tidy up the folder" });
  await settled();

  expect(requests).toHaveLength(1);
  expect((await snapshot()).goal).toEqual({
    objective: "Tidy up the folder",
    status: "active",
    waiting: true,
  });

  // Answering picks the goal up again.
  script.push(
    { tool: "current_datetime", args: {} },
    { text: "Working." },
    { text: "Still going." },
  );
  await host.handle({ type: "prompt", text: "the Documents one", attachments: [] });
  await until(async () => requests.length >= 4);
  await settled();
  expect(requests[3]!.messages.join("\n")).toContain("Continue working toward the goal");
});

test("pausing stops the follow-up turns and resuming starts the next one", async () => {
  script.push({ tool: "current_datetime", args: {} }, { text: "Progress." });
  await host.handle({ type: "set_goal", action: "start", objective: "Watch the clock" });
  await host.handle({ type: "set_goal", action: "pause" });
  await settled();

  expect(requests).toHaveLength(2);
  expect((await snapshot()).goal?.status).toBe("paused");

  script.push({ tool: "current_datetime", args: {} }, { text: "More progress." });
  await host.handle({ type: "set_goal", action: "resume" });
  expect((await snapshot()).goal?.status).toBe("active");
  await until(() => requests.length >= 3);
  expect(requests[2]!.messages.join("\n")).toContain("Continue working toward the goal");

  await host.handle({ type: "set_goal", action: "pause" });
  await settled();
  await host.handle({ type: "set_goal", action: "clear" });
  expect((await snapshot()).goal).toBeNull();
});

test("a goal needs an objective and only one at a time", async () => {
  await expect(
    host.handle({ type: "set_goal", action: "start", objective: "   " }),
  ).rejects.toThrow();
  script.push({ text: "On it." });
  await host.handle({ type: "set_goal", action: "start", objective: "First" });
  await settled();
  await expect(
    host.handle({ type: "set_goal", action: "start", objective: "Second" }),
  ).rejects.toThrow();
  await expect(host.handle({ type: "set_goal", action: "resume" })).rejects.toThrow();
});
