/**
 * Several skills in one message, inside a real host (scripted OpenAI-style model): the model gets
 * every skill's instructions, and the chat shows each skill and the person's own text.
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
  dir = await mkdtemp(join(tmpdir(), "pp-agent-skills-"));
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

/** Saves the skills, then opens a fresh chat: a new session loads them. */
async function withSkills(skills: Record<string, string>): Promise<void> {
  for (const [name, body] of Object.entries(skills)) {
    await host.handle({
      type: "save_skill",
      skill: { name, description: `The ${name} skill`, modelInvocable: true, body },
    });
  }
  await host.handle({ type: "new_chat" });
}

test("two skills in one message both reach the model, and the chat shows them", async () => {
  await withSkills({ "alpha-skill": "ALPHA-INSTRUCTIONS", "beta-skill": "BETA-INSTRUCTIONS" });
  await host.handle({
    type: "prompt",
    text: "/skill:alpha-skill /skill:beta-skill make the plan",
    attachments: [],
  });
  await settled();

  const sent = requests[0]!.messages.join("\n");
  expect(sent).toContain("ALPHA-INSTRUCTIONS");
  expect(sent).toContain("BETA-INSTRUCTIONS");
  expect(sent).toContain("make the plan");

  const user = (await snapshot()).messages.find((message) => message.role === "user")!;
  expect(user.parts).toEqual([
    { type: "skill", name: "alpha-skill" },
    { type: "skill", name: "beta-skill" },
    { type: "text", text: "make the plan" },
  ]);
});

test("one skill still works as before", async () => {
  await withSkills({ "alpha-skill": "ALPHA-INSTRUCTIONS" });
  await host.handle({ type: "prompt", text: "/skill:alpha-skill go", attachments: [] });
  await settled();

  expect(requests[0]!.messages.join("\n")).toContain("ALPHA-INSTRUCTIONS");
  const user = (await snapshot()).messages.find((message) => message.role === "user")!;
  expect(user.parts).toEqual([
    { type: "skill", name: "alpha-skill" },
    { type: "text", text: "go" },
  ]);
});
