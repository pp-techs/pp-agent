/**
 * The approval gate of the `computer` tool inside a real host (scripted OpenAI-style model): an app
 * the person blocks while its approval card waits stays blocked, whatever they answer afterwards.
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
  ComputerAppAccess,
  ComputerRequest,
  StoredCredential,
} from "@workspace/shared";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { AgentHost } from "./index.ts";

/** Answers each request with the next scripted tool call, then with plain text. */
function modelServer(calls: Record<string, unknown>[]) {
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      // The background title and memory passes are not part of the scripted conversation.
      const background = /short title for it|lasting facts/.test(Buffer.concat(chunks).toString());
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
      const call = background ? undefined : calls.shift();
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
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    },
  };
}

const NOTES = { id: "com.apple.Notes", name: "Notes" };

let dir: string;
let calls: Record<string, unknown>[];
let model: ReturnType<typeof modelServer>;
let host: AgentHost;
let request: ReturnType<typeof vi.fn<(request: ComputerRequest) => Promise<{ text: string }>>>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pp-agent-computer-"));
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
  await host.handle({ type: "new_chat" });
});

afterEach(async () => {
  await host.dispose();
  await new Promise((resolve) => model.server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

const snapshot = async () => (await host.handle({ type: "get_snapshot" })) as AgentSnapshot;
const apps = async () => (await host.handle({ type: "list_computer_apps" })) as ComputerAppAccess;

async function until(condition: () => Promise<boolean> | boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out");
}

async function pendingApproval() {
  await until(async () => (await snapshot()).approvals.length > 0);
  return (await snapshot()).approvals[0]!;
}

test("an app blocked while its first-use card waits stays blocked, even after Always allow", async () => {
  calls.push({ action: "snapshot", app: NOTES.id });
  await host.handle({ type: "prompt", text: "look at notes", attachments: [] });
  const approval = await pendingApproval();
  expect(approval.app?.id).toBe(NOTES.id);

  await host.handle({ type: "set_computer_app_access", app: NOTES, access: "blocked" });
  await host.handle({
    type: "respond_approval",
    requestId: approval.requestId,
    approved: true,
    remember: "always",
  });
  await until(async () => (await snapshot()).status === "idle");

  expect(request).not.toHaveBeenCalled();
  expect(await apps()).toEqual({ allowed: [], blocked: [NOTES] });
});

test("an app allowed for the chat and blocked while an action waits does not run the action", async () => {
  calls.push({ action: "snapshot", app: NOTES.id }, { action: "click", app: NOTES.id, x: 1, y: 2 });
  await host.handle({ type: "prompt", text: "click in notes", attachments: [] });
  const first = await pendingApproval();
  await host.handle({
    type: "respond_approval",
    requestId: first.requestId,
    approved: true,
    remember: "conversation",
  });
  await until(() => request.mock.calls.length === 1);

  // The click asks as an action of an app the chat already allowed: no app on the card.
  const click = await pendingApproval();
  expect(click.app).toBeUndefined();
  await host.handle({ type: "set_computer_app_access", app: NOTES, access: "blocked" });
  await host.handle({ type: "respond_approval", requestId: click.requestId, approved: true });
  await until(async () => (await snapshot()).status === "idle");

  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]![0]).toMatchObject({ action: "snapshot" });
});
