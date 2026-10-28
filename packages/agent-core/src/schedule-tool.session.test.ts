/**
 * `schedule_manage` and `sessions` inside a real Pi session (scripted model): Pi accepts the
 * schemas, the model's arguments reach the host, and a refusal comes back as an error result.
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
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type ToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { createScheduleTool, SCHEDULE_TOOL, type ScheduleHost } from "./schedule-tool.ts";
import { createSessionsTool, SESSIONS_TOOL } from "./sessions-tool.ts";

const args = (value: unknown) => value as ToolCall["arguments"];

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup(tools: ToolDefinition[]) {
  const dir = await mkdtemp(join(tmpdir(), "pp-agent-schedule-"));
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
    customTools: tools,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(dir),
  });
  return { session, faux };
}

const toolResults = (session: Awaited<ReturnType<typeof setup>>["session"]) =>
  session.messages.filter((message) => message.role === "toolResult");

describe("schedule_task in a Pi session", () => {
  test("the model's schedule reaches the host and the next run comes back", async () => {
    const created: Parameters<ScheduleHost["create"]>[0][] = [];
    const nextRun = new Date(2026, 9, 30, 16, 0).getTime();
    const { session, faux } = await setup([
      createScheduleTool({
        create: (input) => {
          created.push(input);
          return { name: input.name, nextRun };
        },
        list: () => [],
        update: () => {},
        pause: () => {},
        resume: () => {},
        runNow: () => {},
        remove: () => {},
      }),
    ]);
    expect(session.getActiveToolNames()).toContain(SCHEDULE_TOOL);
    const call = {
      action: "create" as const,
      name: "Friday summary",
      prompt: "Summarize the files in Reports.",
      when: { kind: "weekly" as const, days: [5], time: "16:00" },
    };
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall(SCHEDULE_TOOL, args(call), { id: "call-1" })),
      fauxAssistantMessage(fauxText("Done.")),
    ]);
    await session.prompt("every Friday at 16:00 summarize Reports");
    await session.waitForIdle();

    expect(created).toHaveLength(1);
    expect(created[0]?.name).toBe("Friday summary");
    expect(created[0]?.prompt).toBe("Summarize the files in Reports.");
    expect(created[0]?.schedule).toEqual({ kind: "weekly", days: [5], time: "16:00" });
    expect(created[0]?.enabled).toBe(true);
    const [result] = toolResults(session);
    expect(result?.isError).toBe(false);
    expect(JSON.stringify(result?.content)).toContain("Friday summary");
  });

  test("a refusal of the host is an error the model can read", async () => {
    const { session, faux } = await setup([
      createScheduleTool({
        create: () => {
          throw new Error("A task named Friday summary already exists.");
        },
        list: () => [],
        update: () => {},
        pause: () => {},
        resume: () => {},
        runNow: () => {},
        remove: () => {},
      }),
    ]);
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(
          SCHEDULE_TOOL,
          args({
            action: "create",
            name: "Friday summary",
            prompt: "Summarize.",
            when: { kind: "interval", every: 2, unit: "hours" },
          }),
          { id: "call-1" },
        ),
      ),
      fauxAssistantMessage(fauxText("Okay.")),
    ]);
    await session.prompt("every 2 hours");
    await session.waitForIdle();
    const [result] = toolResults(session);
    expect(result?.isError).toBe(true);
    expect(JSON.stringify(result?.content)).toContain("already exists");
  });
});

describe("sessions in a Pi session", () => {
  test("Pi accepts the schema and the model reads a list, a history and the peers", async () => {
    const { session, faux } = await setup([
      createSessionsTool({
        list: async () => [
          {
            id: "s1",
            title: "Weekly report",
            kind: "chat",
            peer: "telegram:42",
            workspaceId: "default",
            modified: 1_700_000_000_000,
            messageCount: 4,
            preview: "write the weekly report",
            isCurrent: false,
          },
        ],
        history: async () => [{ role: "user", text: "write the weekly report", at: null }],
        currentId: () => null,
        peers: () => [{ id: "home", label: "Telegram – Nhat", key: "telegram:42" }],
        visibility: () => "all",
        locale: () => "en",
      }),
    ]);
    expect(session.getActiveToolNames()).toContain(SESSIONS_TOOL);
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(SESSIONS_TOOL, args({ action: "list", kind: "chat", limit: 5 }), {
          id: "call-1",
        }),
      ),
      fauxAssistantMessage(
        fauxToolCall(SESSIONS_TOOL, args({ action: "history", sessionId: "s1" }), {
          id: "call-2",
        }),
      ),
      fauxAssistantMessage(
        fauxToolCall(SESSIONS_TOOL, args({ action: "peers" }), { id: "call-3" }),
      ),
      fauxAssistantMessage(fauxText("Done.")),
    ]);
    await session.prompt("what did I ask on telegram?");
    await session.waitForIdle();

    const results = toolResults(session);
    expect(results.map((result) => result.isError)).toEqual([false, false, false]);
    expect(JSON.stringify(results[0]?.content)).toContain("telegram:42");
    expect(JSON.stringify(results[1]?.content)).toContain("write the weekly report");
    expect(JSON.stringify(results[2]?.content)).toContain("id: home");
  });
});
