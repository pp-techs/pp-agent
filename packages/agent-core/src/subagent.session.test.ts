/**
 * `delegate_task` inside a real host (scripted OpenAI-style model): one call runs several sub
 * agents, a task can name an Agent whose rules the sub agent follows, the parent gets one summary
 * per task, and an unknown Agent fails the call before anything runs.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, AgentPaths, StoredCredential } from "@workspace/shared";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { AgentHost } from "./index.ts";

interface ChatMessage {
  role: string;
  content?: string | { text?: string }[] | null;
}
interface ChatRequest {
  messages: ChatMessage[];
}

const text = (message: ChatMessage | undefined): string =>
  typeof message?.content === "string"
    ? message.content
    : (message?.content ?? []).map((part) => part.text ?? "").join("");

/** Requests the sub agents sent (their system prompt names them "research helper"). */
let helperRequests: ChatRequest[];
/** Settles with the tool result the parent saw in its follow-up request. */
let parentSaw: PromiseWithResolvers<string>;
/** Arguments of the `delegate_task` call the parent makes. */
let delegateArgs: Record<string, unknown>;

interface ModelServer {
  server: Server;
  listen(): Promise<string>;
}

function modelServer(): ModelServer {
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString()) as ChatRequest;
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
      const isHelper = text(body.messages.find((m) => m.role === "system")).includes(
        "research helper",
      );
      const toolMessage = body.messages.find((m) => m.role === "tool");
      if (isHelper) {
        helperRequests.push(body);
        const task = text(body.messages.findLast((m) => m.role === "user"));
        send({ content: `Found: ${task}` });
        send({}, "stop");
      } else if (toolMessage) {
        parentSaw.resolve(text(toolMessage));
        send({ content: "all done" });
        send({}, "stop");
      } else {
        send({
          tool_calls: [
            {
              index: 0,
              id: "call-1",
              type: "function",
              function: { name: "delegate_task", arguments: JSON.stringify(delegateArgs) },
            },
          ],
        });
        send({}, "tool_calls");
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

let dir: string;
let model: ModelServer;
let host: AgentHost;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pp-agent-subagent-"));
  helperRequests = [];
  parentSaw = Promise.withResolvers<string>();
  model = modelServer();
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
  await host.handle({
    type: "save_agent",
    agent: {
      name: "Finance",
      icon: "💰",
      description: "Month-end reports.",
      instructions: "Always quote amounts in euros.",
      tools: null,
      mcpServers: null,
      skills: null,
      model: null,
      starterPrompts: [],
      memory: false,
    },
  });
  await host.handle({ type: "new_chat" });
});

afterEach(async () => {
  await host.dispose();
  const { promise, resolve } = Promise.withResolvers<void>();
  model.server.close(() => resolve());
  await promise;
  await rm(dir, { recursive: true, force: true });
});

test("one call runs several sub agents; a named Agent's rules and the shared context reach its sub agent", async () => {
  delegateArgs = {
    context: "The year is 2031.",
    tasks: [
      { task: "sum the invoices", agent: "finance" },
      { task: "list the folders" },
      { task: "list the folders again" },
    ],
  };
  await host.handle({ type: "prompt", text: "research", attachments: [] });
  // Wait for the tool result the parent receives, not a guessed delay.
  await parentSaw.promise;

  expect(helperRequests).toHaveLength(3);
  const prompts = helperRequests.map((request) =>
    text(request.messages.find((m) => m.role === "system")),
  );
  expect(prompts.filter((p) => p.includes("Always quote amounts in euros."))).toHaveLength(1);
  expect(prompts.every((p) => p.includes("The year is 2031."))).toBe(true);

  const result = await parentSaw.promise;
  expect(result).toContain("## Finance\nFound: sum the invoices");
  expect(result).toContain("## Helper 2\nFound: list the folders");
  expect(result).toContain("## Helper 3\nFound: list the folders again");
});

test("an unknown Agent fails the call before any sub agent starts", async () => {
  delegateArgs = { tasks: [{ task: "sum the invoices", agent: "nobody" }] };
  await host.handle({ type: "prompt", text: "research", attachments: [] });
  const result = await parentSaw.promise;

  expect(helperRequests).toHaveLength(0);
  expect(result).toContain('Unknown agent "nobody"');
  expect(result).toContain("Finance");
});
