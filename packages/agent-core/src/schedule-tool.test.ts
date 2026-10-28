import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SaveScheduledTaskInput, ScheduledTask } from "@workspace/shared";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { createScheduleTool, type ScheduleHost } from "./schedule-tool.ts";
import { nextRun, schedulableOf } from "./scheduler.ts";
import { readScheduledTasks, validateTaskInput } from "./scheduled-tasks.ts";
import { SettingsStore } from "./settings-store.ts";

const NOW = Date.UTC(2026, 9, 28, 9);
const SLOT = NOW + 30 * 60_000;
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup(currentSessionId: string | null = "origin-session") {
  const dir = await mkdtemp(join(tmpdir(), "pp-agent-schedule-target-"));
  dirs.push(dir);
  const path = join(dir, "settings.json");
  const settings = new SettingsStore(path);
  const save = (input: SaveScheduledTaskInput) => {
    const tasks = settings.get().scheduledTasks;
    const previous = tasks.find((task) => task.id === input.id);
    const task: ScheduledTask = {
      ...validateTaskInput(input, tasks),
      id: previous?.id ?? `task-${tasks.length + 1}`,
      armedAt: previous?.armedAt ?? NOW,
      lastRun: previous?.lastRun ?? null,
    };
    settings.update((draft) => {
      const index = draft.scheduledTasks.findIndex((entry) => entry.id === task.id);
      if (index < 0) draft.scheduledTasks.push(task);
      else draft.scheduledTasks[index] = task;
    });
    return { name: task.name, nextRun: nextRun(schedulableOf(task), NOW) };
  };
  const host: ScheduleHost = {
    currentSessionId: () => currentSessionId,
    create: save,
    update: (name, patch) => {
      const task = settings.get().scheduledTasks.find((entry) => entry.name === name);
      if (!task) throw new Error("Task not found.");
      save({ ...task, ...patch });
    },
    list: () => [],
    pause: () => {},
    resume: () => {},
    runNow: () => {},
    remove: () => {},
  };
  const tool = createScheduleTool(host);
  const execute = (params: Parameters<typeof tool.execute>[1]) =>
    tool.execute("call-1", params, undefined, undefined, undefined as never);
  return {
    execute,
    settings,
    reload: () => new SettingsStore(path).get().scheduledTasks,
  };
}

const create = {
  action: "create" as const,
  name: "Reminder",
  prompt: "Remember to review the report.",
  when: { kind: "once" as const, at: SLOT },
};

describe("schedule_manage persisted targets", () => {
  test("current resolves to the originating conversation and survives a settings reload", async () => {
    const { execute, reload } = await setup();
    const result = await execute({ ...create, target: "current" });
    expect(JSON.stringify(result.content)).toContain("Created");
    expect(reload()[0]?.target).toEqual({ mode: "current", sessionId: "origin-session" });
  });

  test("updating to current stores the originating conversation rather than the old target", async () => {
    const { execute, reload } = await setup();
    await execute({ ...create, target: "session:old-session" });
    await execute({ action: "update", name: create.name, target: "current" });
    expect(reload()[0]?.target).toEqual({ mode: "current", sessionId: "origin-session" });
  });

  test.each([null, "", "   "])("current rejects an unsaved conversation (%j)", async (id) => {
    const { execute, reload } = await setup(id);
    await expect(execute({ ...create, target: "current" })).rejects.toThrow(
      "requires a saved conversation",
    );
    expect(reload()).toEqual([]);
    await execute({ ...create, target: "new" });
    await expect(
      execute({ action: "update", name: create.name, target: "current" }),
    ).rejects.toThrow("requires a saved conversation");
    expect(reload()[0]?.target).toEqual({ mode: "new" });
  });

  test.each(["", "   ", "session:", "session:   ", "sesssion:s1", "other"])(
    "invalid target %j fails creation and leaves an existing target unchanged on update",
    async (target) => {
      const { execute, reload } = await setup();
      await expect(execute({ ...create, target })).rejects.toThrow("`target`");
      expect(reload()).toEqual([]);
      await execute({ ...create, target: "session:retained-session" });
      await expect(execute({ action: "update", name: create.name, target })).rejects.toThrow(
        "`target`",
      );
      expect(reload()[0]?.target).toEqual({ mode: "session", sessionId: "retained-session" });
    },
  );

  test.each([
    { target: undefined, expected: undefined },
    { target: "new", expected: { mode: "new" } },
    {
      target: "session:chosen-session",
      expected: { mode: "session", sessionId: "chosen-session" },
    },
  ])(
    "supported target $target keeps its existing semantics after reload",
    async ({ target, expected }) => {
      const { execute, reload } = await setup(null);
      await execute({ ...create, ...(target !== undefined ? { target } : {}) });
      expect(reload()[0]?.target).toEqual(expected);
    },
  );
});

describe("schedule_manage persisted delivery", () => {
  test.each(["", "   ", "peer", "peer:", "peer:   ", "peer:\t\n", "sesssion", "session ", "other"])(
    "invalid delivery %j fails creation and leaves the entire existing task unchanged on update",
    async (deliver) => {
      const { execute, reload } = await setup();
      await expect(execute({ ...create, deliver })).rejects.toThrow("`deliver`");
      expect(reload()).toEqual([]);
      await execute({
        ...create,
        target: "session:retained-session",
        deliver: "peer:telegram:-100456",
      });
      const before = reload();
      await expect(
        execute({
          action: "update",
          name: create.name,
          prompt: "This must not replace the stored prompt.",
          target: "new",
          deliver,
          deleteAfterRun: true,
        }),
      ).rejects.toThrow("`deliver`");
      expect(reload()).toEqual(before);
    },
  );

  test.each([
    { deliver: undefined, expected: undefined },
    { deliver: "session", expected: undefined },
    { deliver: "none", expected: { to: "none" } },
    { deliver: "home", expected: { to: "peer", peer: "home" } },
    { deliver: "peer:telegram:-100456", expected: { to: "peer", peer: "telegram:-100456" } },
  ])(
    "supported delivery $deliver retains its destination after reload",
    async ({ deliver, expected }) => {
      const { execute, reload } = await setup();
      await execute({
        ...create,
        target: "session:retained-session",
        ...(deliver !== undefined ? { deliver } : {}),
      });
      expect(reload()[0]?.delivery).toEqual(expected);
      expect(reload()[0]?.target).toEqual({ mode: "session", sessionId: "retained-session" });
      if (deliver !== undefined) {
        await execute({ action: "update", name: create.name, deliver: "peer:other-destination" });
        await execute({ action: "update", name: create.name, deliver });
        expect(reload()[0]?.delivery).toEqual(expected);
        expect(reload()[0]?.target).toEqual({ mode: "session", sessionId: "retained-session" });
      }
    },
  );
});

describe("persisted task run delivery", () => {
  test.each(["sent", "session", "none", "failed: Telegram unavailable"])(
    "restores delivery outcome %j alongside the rest of the run",
    async (delivery) => {
      const { execute, settings, reload } = await setup();
      await execute(create);
      const run = {
        at: SLOT,
        durationMs: 1_000,
        status: "completed" as const,
        deniedTools: 0,
        sessionPath: "/sessions/run.jsonl",
        delivery,
      };
      settings.update((draft) => {
        draft.scheduledTasks[0]!.lastRun = run;
      });
      expect(reload()[0]?.lastRun).toEqual(run);
    },
  );

  test("bounds delivery diagnostics without losing the run", async () => {
    const { execute, settings, reload } = await setup();
    await execute(create);
    settings.update((draft) => {
      draft.scheduledTasks[0]!.lastRun = {
        at: SLOT,
        durationMs: 0,
        status: "failed",
        deniedTools: 0,
        delivery: `failed: ${"x".repeat(3_000)}`,
      };
    });
    expect(reload()[0]?.lastRun?.delivery).toBe(`failed: ${"x".repeat(3_000)}`.slice(0, 2_000));
    expect(reload()[0]?.lastRun?.status).toBe("failed");
  });

  test.each([{ delivery: "" }, { delivery: "   " }, { delivery: null }, { delivery: 42 }])(
    "ignores an invalid delivery outcome $delivery without dropping the run",
    async ({ delivery }) => {
      const { execute, reload } = await setup();
      await execute(create);
      const tasks = readScheduledTasks([
        {
          ...reload()[0],
          lastRun: { at: SLOT, durationMs: 0, status: "completed", deniedTools: 0, delivery },
        },
      ]);
      expect(tasks[0]?.lastRun).toEqual({
        at: SLOT,
        durationMs: 0,
        status: "completed",
        deniedTools: 0,
      });
    },
  );
});
