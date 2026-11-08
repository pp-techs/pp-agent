/**
 * Research mode inside a real host (scripted OpenAI-style model): a run plans, asks the person to
 * confirm the plan, researches in rounds, records sources, saves the report, and ends. The tools
 * exist only while a run is active, and the report is written inside `research/` without approval.
 */
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentEvent,
  AgentPaths,
  AgentSnapshot,
  QuestionRequest,
  StoredCredential,
} from "@workspace/shared";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { AgentHost } from "./index.ts";

type Step = { tool: string; args: Record<string, unknown> } | { text: string };

interface Request {
  tools: string[];
  system: string;
  messages: string[];
}

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
      const step = (background ? undefined : script.shift()) ?? { text: "ok" };
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
let workspaceDir: string;
let script: Step[];
let requests: Request[];
let events: AgentEvent[];
let planAnswer = "Start";
let server: Server;
let host: AgentHost;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pp-agent-research-"));
  workspaceDir = join(dir, "workspace");
  script = [];
  requests = [];
  events = [];
  planAnswer = "Start";
  server = modelServer(script, requests);
  const store = new Map<string, StoredCredential>();
  host = new AgentHost({
    output: {
      emit: (event: AgentEvent) => {
        events.push(event);
        // The plan card is answered here in place of a person.
        if (event.type === "question_requested") void answerPlan(event.request, planAnswer);
      },
      openUrl: () => undefined,
    },
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
    workspaceDir,
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

/** Answers a plan card; `start` picks the confirm option ("Start" or "Narrow the scope"). */
async function answerPlan(request: QuestionRequest, start = "Start"): Promise<void> {
  const answers = request.questions.map((question) => ({
    id: question.id,
    selected: [question.id === "start" ? start : (question.options[0]?.label ?? "Standard")],
  }));
  await host.handle({ type: "respond_question", requestId: request.requestId, answers });
}

const snapshot = async () => (await host.handle({ type: "get_snapshot" })) as AgentSnapshot;

async function until(condition: () => Promise<boolean> | boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out");
}

async function settled(): Promise<void> {
  await until(async () => (await snapshot()).status === "idle");
  await new Promise((resolve) => setTimeout(resolve, 150));
  await until(async () => (await snapshot()).status === "idle");
}

test("a run plans, confirms the plan, researches, records sources and saves the report", async () => {
  script.push(
    {
      tool: "research_plan",
      args: { plan: "Research the market.", questions: [] },
    },
    {
      tool: "research_sources",
      args: {
        sources: [
          { title: "Market 2025", url: "https://a.example/report", type: "primary" },
          { title: "Market 2025", url: "https://a.example/report", type: "primary" },
          { title: "News", url: "https://b.example/news", type: "press" },
        ],
      },
    },
    {
      tool: "research_report",
      args: {
        markdown: "# Report\n\nGrowth of 24% in 2025 [1][2].",
        final: true,
      },
    },
    { text: "Done: growth of 24%." },
  );
  await host.handle({
    type: "set_research",
    action: "start",
    question: "How fast is the market growing?",
    depth: "standard",
  });
  expect((await snapshot()).research?.question).toBe("How fast is the market growing?");
  await settled();

  // The plan card carried the plan and the confirm questions.
  const planQuestion = events.find((event) => event.type === "question_requested");
  expect(planQuestion?.type === "question_requested" && planQuestion.request.plan).toBe(
    "Research the market.",
  );
  // Research tools were active while the run was, and the run carried on by itself.
  for (const request of requests) {
    expect(request.tools).toContain("research_plan");
    expect(request.system).toContain("Research");
  }
  expect(requests.length).toBeGreaterThanOrEqual(4);

  // The report is saved inside research/, without approval (no approval was ever requested).
  const saved = (await snapshot()).research;
  const savedPath = saved?.report?.markdown ?? "";
  expect(savedPath.startsWith("research/")).toBe(true);
  expect(readFileSync(join(workspaceDir, savedPath), "utf8")).toContain("24%");
  // The duplicate source got one number; three entries but two URLs → sources numbered 1 and 2.
  const done = saved;
  expect(done?.status).toBe("done");
  expect(done?.sources.map((s) => s.url)).toEqual([
    "https://a.example/report",
    "https://b.example/news",
  ]);
  // The report text is readable for clients with no workspace.
  const report = (await host.handle({ type: "get_research_report" })) as {
    markdown: string;
    markdownPath: string;
  };
  expect(report.markdown).toContain("24%");
  expect(report.markdownPath).toBe(savedPath);

  // Once done, the research tools are gone again.
  await host.handle({ type: "prompt", text: "thanks", attachments: [] });
  await settled();
  const last = requests[requests.length - 1];
  expect(last.tools).not.toContain("research_plan");
});

test("the plan card carries the plan, and a change to it keeps the run planning", async () => {
  planAnswer = "Narrow the scope";
  script.push({ tool: "research_plan", args: { plan: "Plan v1" } }, { text: "On it." });
  await host.handle({
    type: "set_research",
    action: "start",
    question: "A question",
    depth: "quick",
  });
  await settled();
  const request = events.find((event) => event.type === "question_requested");
  expect(request?.type === "question_requested" && request.request.plan).toBe("Plan v1");
  // The plan card asks the depth and the confirm question.
  expect(
    request?.type === "question_requested" &&
      request.request.questions.map((question) => question.id),
  ).toEqual(["depth", "start"]);
  // The test answered a clarifying question and the depth, then "Narrow": still planning.
  expect((await snapshot()).research?.phase).toBe("planning");
});

test("pausing stops the follow-up turns and resuming starts the next one", async () => {
  script.push({ tool: "current_datetime", args: {} }, { text: "Progress." });
  await host.handle({
    type: "set_research",
    action: "start",
    question: "Watch the clock",
    depth: "standard",
  });
  await settled();
  expect((await snapshot()).research?.status).toBe("active");

  await host.handle({ type: "set_research", action: "pause" });
  expect((await snapshot()).research?.status).toBe("paused");
  await settled();

  await host.handle({ type: "set_research", action: "resume" });
  expect((await snapshot()).research?.status).toBe("active");
  await settled();

  await host.handle({ type: "set_research", action: "clear" });
  expect((await snapshot()).research).toBeNull();
});

test("a run refuses to overlap a goal or another run, and needs a question", async () => {
  await expect(
    host.handle({ type: "set_research", action: "start", question: "  ", depth: "quick" }),
  ).rejects.toThrow();
  script.push({ text: "On it." });
  await host.handle({ type: "set_research", action: "start", question: "First", depth: "quick" });
  await settled();
  await expect(
    host.handle({ type: "set_research", action: "start", question: "Second", depth: "quick" }),
  ).rejects.toThrow();
  await expect(host.handle({ type: "set_research", action: "resume" })).rejects.toThrow();
});

test("a report save never overwrites a file the run did not create", async () => {
  const folder = join(workspaceDir, "research");
  await (await import("node:fs/promises")).mkdir(folder, { recursive: true });
  await writeFile(join(folder, "report.md"), "someone else's file");
  script.push(
    {
      tool: "research_report",
      args: { markdown: "# Mine", final: true },
    },
    { text: "Done." },
  );
  await host.handle({
    type: "set_research",
    action: "start",
    question: "report",
    depth: "quick",
  });
  await settled();
  // The existing report.md is untouched; the run took a free name.
  expect(readFileSync(join(folder, "report.md"), "utf8")).toBe("someone else's file");
  const run = (await snapshot()).research;
  expect(run?.report?.markdown).not.toBe("research/report.md");
  expect(run?.report?.markdown).toMatch(/^research\/report-\d{4}-\d{2}-\d{2}(-\d+)?\.md$/);
});
