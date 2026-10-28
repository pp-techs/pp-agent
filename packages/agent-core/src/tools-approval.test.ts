import { describe, expect, test } from "vite-plus/test";
import { SCHEDULE_TOOL } from "./schedule-tool.ts";
import { describeToolCall } from "./tools.ts";

describe("schedule approval disclosure", () => {
  test("shows the action, time, target and delivery before a long prompt", () => {
    const approval = describeToolCall(SCHEDULE_TOOL, {
      action: "create",
      name: "Morning report",
      when: { kind: "once", at: 1793170800000 },
      target: "current",
      deliver: "peer:telegram:-100456",
      deleteAfterRun: true,
      silentIfEmpty: false,
      prompt: "Private report instructions. ".repeat(100),
    });
    expect(approval.detail).toContain("create");
    expect(approval.detail).toContain('"kind":"once"');
    expect(approval.detail).toContain("1793170800000");
    expect(approval.detail).toContain("target: current");
    expect(approval.detail).toContain("deliver: peer:telegram:-100456");
    expect(approval.detail).toContain("deleteAfterRun: true");
    expect(approval.detail).toContain("silentIfEmpty: false");
  });

  test("distinguishes removal from creation and identifies the affected task", () => {
    const removal = describeToolCall(SCHEDULE_TOOL, { action: "remove", name: "Morning report" });
    expect(removal.title).toContain("Morning report");
    expect(removal.detail).toBe("remove");
  });

  test("shows update arguments rather than the obsolete schedule field", () => {
    const update = describeToolCall(SCHEDULE_TOOL, {
      action: "update",
      name: "Morning report",
      when: { kind: "daily", time: "07:00" },
      target: "session:reports",
      deliver: "none",
    });
    expect(update.detail).toContain("update");
    expect(update.detail).toContain('"time":"07:00"');
    expect(update.detail).toContain("target: session:reports");
    expect(update.detail).toContain("deliver: none");
  });
});
