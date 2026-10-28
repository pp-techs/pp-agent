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

  test.each([
    { field: "action", value: `create${"x".repeat(2_000)}` },
    { field: "when", value: { kind: "daily", time: "07:00".repeat(2_000) } },
    { field: "target", value: `session:${"x".repeat(2_000)}` },
    { field: "deliver", value: `peer:telegram:${"1".repeat(2_000)}` },
  ])("a long $field cannot hide the remaining controls", ({ field, value }) => {
    const input: Record<string, unknown> = {
      action: "create",
      name: "Morning report",
      when: { kind: "daily", time: "07:00" },
      target: "session:reports",
      deliver: "peer:telegram:-100456",
      deleteAfterRun: true,
      silentIfEmpty: false,
      prompt: "Private report instructions. ".repeat(100),
      [field]: value,
    };
    const approval = describeToolCall(SCHEDULE_TOOL, input);
    expect(approval.detail).toContain("create");
    expect(approval.detail).toContain('"kind":"daily"');
    expect(approval.detail).toContain("target: session:");
    expect(approval.detail).toContain("deliver: peer:telegram:");
    expect(approval.detail).toContain("deleteAfterRun: true");
    expect(approval.detail).toContain("silentIfEmpty: false");
    expect(approval.detail).toContain("Private report instructions.");
    expect(approval.detail.length).toBeLessThanOrEqual(600);
    expect(input[field]).toEqual(value);
  });

  test("bounds all control fields separately and gives only the remaining space to the prompt", () => {
    const approval = describeToolCall(SCHEDULE_TOOL, {
      action: `update${"a".repeat(2_000)}`,
      when: { kind: "daily", time: "07:00".repeat(2_000) },
      target: `session:${"s".repeat(2_000)}`,
      deliver: `peer:telegram:${"1".repeat(2_000)}`,
      deleteAfterRun: false,
      silentIfEmpty: true,
      prompt: "Private report instructions. ".repeat(100),
    });
    const controls = approval.detail.split("\n").slice(0, 6);
    expect(controls).toHaveLength(6);
    expect(controls[0]).toMatch(/^update.*…$/);
    expect(controls[1]).toMatch(/^\{"kind":"daily".*…$/);
    expect(controls[2]).toMatch(/^target: session:.*…$/);
    expect(controls[3]).toMatch(/^deliver: peer:telegram:.*…$/);
    expect(controls[4]).toBe("deleteAfterRun: false");
    expect(controls[5]).toBe("silentIfEmpty: true");
    expect(controls.every((control) => control.length <= 100)).toBe(true);
    expect(approval.detail).toContain("\nPrivate report instructions.");
    expect(approval.detail).toMatch(/…$/);
    expect(approval.detail.length).toBe(600);
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
