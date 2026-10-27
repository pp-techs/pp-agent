/**
 * `ask_user` inside a real Pi session (scripted model): the tool's schema is accepted by Pi, the
 * answers reach the model as the tool result, and a skipped question ends as an error result.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type ToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { ASK_TOOL, createAskTool, type AskUser } from "./ask.ts";

/** The model's JSON arguments. */
const args = (value: unknown) => value as ToolCall["arguments"];

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const QUESTIONS = [
  {
    id: "scope",
    question: "Which period?",
    options: [{ label: "Q3", description: "July to September" }, { label: "Q4" }],
    recommended: 1,
  },
  {
    id: "formats",
    question: "Which formats?",
    multi: true,
    options: [{ label: "PDF" }, { label: "Excel" }],
  },
];

async function setup(askUser: AskUser) {
  const dir = await mkdtemp(join(tmpdir(), "pp-agent-ask-"));
  dirs.push(dir);
  const faux = fauxProvider();
  const runtime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  runtime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory({});
  const resourceLoader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    settingsManager,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    noSkills: true,
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    modelRuntime: runtime,
    model: faux.getModel(),
    tools: ["-bash", "-powershell", "-edit", "-write"],
    customTools: [createAskTool(askUser)],
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(dir),
  });
  return { session, faux };
}

function toolResults(session: Awaited<ReturnType<typeof setup>>["session"]) {
  return session.messages.filter((message) => message.role === "toolResult");
}

describe("ask_user in a Pi session", () => {
  test("the model's call reaches the person and the answers come back as the tool result", async () => {
    const asked: unknown[] = [];
    const { session, faux } = await setup(async (call) => {
      asked.push(call);
      return [
        { id: "scope", selected: ["Q4"] },
        { id: "formats", selected: ["PDF"], custom: "CSV" },
      ];
    });
    expect(session.getActiveToolNames()).toContain(ASK_TOOL);
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(ASK_TOOL, args({ questions: QUESTIONS }), { id: "call-1" }),
      ),
      fauxAssistantMessage(fauxText("Thanks, going with Q4.")),
    ]);
    await session.prompt("make the report");
    await session.waitForIdle();

    expect(asked).toEqual([{ toolCallId: "call-1", questions: QUESTIONS }]);
    const [result] = toolResults(session);
    expect(result?.isError).toBe(false);
    expect(JSON.stringify(result?.content)).toContain(
      "User answers:\\n- scope: Q4\\n- formats: PDF, Other: CSV",
    );
  });

  test("a skipped question comes back as an error the model can read", async () => {
    const { session, faux } = await setup(async () => null);
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(ASK_TOOL, args({ questions: [QUESTIONS[0]] }), { id: "call-1" }),
      ),
      fauxAssistantMessage(fauxText("Understood.")),
    ]);
    await session.prompt("make the report");
    await session.waitForIdle();
    const [result] = toolResults(session);
    expect(result?.isError).toBe(true);
    expect(JSON.stringify(result?.content)).toContain("The user chose not to answer.");
  });

  test("arguments that break the schema never reach the person", async () => {
    let asked = 0;
    const { session, faux } = await setup(async () => {
      asked += 1;
      return null;
    });
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(
          ASK_TOOL,
          args({ questions: [{ ...QUESTIONS[0], options: [{ label: "Only one" }] }] }),
          { id: "call-1" },
        ),
      ),
      fauxAssistantMessage(fauxText("Sorry.")),
    ]);
    await session.prompt("make the report");
    await session.waitForIdle();
    expect(asked).toBe(0);
    expect(toolResults(session)[0]?.isError).toBe(true);
  });

  test("an abort while the person is still answering settles the call", async () => {
    let seen: AbortSignal | undefined;
    const { session, faux } = await setup(
      (_, signal) =>
        new Promise((resolve) => {
          seen = signal;
          signal?.addEventListener("abort", () => resolve(null), { once: true });
        }),
    );
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(ASK_TOOL, args({ questions: [QUESTIONS[0]] }), { id: "call-1" }),
      ),
      fauxAssistantMessage(fauxText("ok")),
    ]);
    const running = session.prompt("make the report");
    await expect.poll(() => seen !== undefined).toBe(true);
    await session.abort();
    await running;
    await session.waitForIdle();
    expect(seen?.aborted).toBe(true);
  });
});
