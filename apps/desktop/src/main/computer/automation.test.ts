import { describe, expect, it, vi } from "vite-plus/test";

import { ComputerAutomation, type DriverCall } from "./automation.ts";
import type { McpToolResult } from "./mcp-client.ts";

const APPS = [
  { name: "Notes", pid: 101, bundle_id: "com.apple.Notes", running: true },
  { name: "Terminal", pid: 102, bundle_id: "com.apple.Terminal", running: true },
  { name: "PP Agent Helper", pid: 103, bundle_id: "com.example.helper", running: true },
  { name: "Calculator", pid: 0, bundle_id: "com.apple.calculator", running: false },
];

function reply(text: string, structuredContent?: Record<string, unknown>): McpToolResult {
  return { content: [{ type: "text", text }], ...(structuredContent ? { structuredContent } : {}) };
}

/** A driver with Notes (window 7, snapshot s00000001) and a counter of snapshots. */
function fakeDriver() {
  let snapshot = 0;
  const call = vi.fn<DriverCall>(async (name, args) => {
    switch (name) {
      case "list_apps":
        return reply("apps", { apps: APPS });
      case "list_windows":
        return reply("windows", {
          windows: [
            { window_id: 7, pid: 101, title: "Notes", layer: 0, z_index: 5 },
            { window_id: 8, pid: 101, title: "Old", layer: 0, z_index: 2 },
            { window_id: 9, pid: 101, title: "Menu", layer: 24, z_index: 9 },
          ].filter((window) => window.pid === args.pid),
        });
      case "get_window_state": {
        snapshot += 1;
        const id = `s${snapshot.toString(16).padStart(8, "0")}`;
        return {
          content: [
            { type: "text", text: `snapshot_id=${id}\n- [1] AXButton (New Note)` },
            ...(args.include_screenshot === false
              ? []
              : [{ type: "image" as const, data: "iVBOR", mimeType: "image/png" }]),
          ],
          structuredContent: {
            snapshot_id: id,
            invalidated_snapshot_ids:
              snapshot > 1 ? [`s${(snapshot - 1).toString(16).padStart(8, "0")}`] : [],
          },
        };
      }
      case "click":
        return reply("");
      case "launch_app":
        return reply("Launched Calculator (pid 300) in background.");
      default:
        return { content: [{ type: "text", text: `refused ${name}` }], isError: true };
    }
  });
  return { call, automation: new ComputerAutomation(call, () => [103]) };
}

describe("ComputerAutomation", () => {
  it("lists usable apps by id and leaves out protected ones and PP Agent's own", async () => {
    const { automation } = fakeDriver();
    const result = await automation.run({ action: "apps" });
    expect(result.text).toContain("- Notes (com.apple.Notes)");
    expect(result.text).toContain("- Calculator (com.apple.calculator)");
    expect(result.text).not.toContain("Terminal");
    expect(result.text).not.toContain("Helper");
    expect(result.apps).toEqual([
      { id: "com.apple.Notes", name: "Notes" },
      { id: "com.apple.calculator", name: "Calculator" },
    ]);
  });

  it("refuses protected and unknown apps, and apps that are not running", async () => {
    const { automation } = fakeDriver();
    await expect(automation.run({ action: "snapshot", app: "com.apple.Terminal" })).rejects.toThrow(
      /cannot be used/,
    );
    await expect(automation.run({ action: "snapshot", app: "com.nope" })).rejects.toThrow(
      /No app has the id/,
    );
    await expect(
      automation.run({ action: "snapshot", app: "com.apple.calculator" }),
    ).rejects.toThrow(/not running/);
  });

  it("launches by bundle id", async () => {
    const { automation, call } = fakeDriver();
    const result = await automation.run({ action: "launch", app: "com.apple.calculator" });
    expect(call).toHaveBeenCalledWith(
      "launch_app",
      { bundle_id: "com.apple.calculator" },
      undefined,
    );
    expect(result.apps).toEqual([{ id: "com.apple.calculator", name: "Calculator" }]);
  });

  it.each([
    {
      case: "an AUMID",
      app: { name: "Notepad", bundle_id: "Microsoft.WindowsNotepad_8wekyb3d8bbwe!App" },
      args: { bundle_id: "Microsoft.WindowsNotepad_8wekyb3d8bbwe!App" },
    },
    {
      case: "a launch path",
      app: { name: "Excel", launch_path: "C:\\Program Files\\Microsoft Office\\EXCEL.EXE" },
      args: { launch_path: "C:\\Program Files\\Microsoft Office\\EXCEL.EXE" },
    },
    { case: "a bare name", app: { name: "Paint" }, args: { name: "Paint" } },
  ])("launches a Windows app by $case in its own field", async ({ app, args }) => {
    const call = vi.fn<DriverCall>(async (name) =>
      name === "list_apps"
        ? reply("apps", { apps: [{ ...app, pid: 0, running: false }] })
        : reply("Launched."),
    );
    const automation = new ComputerAutomation(call, () => [], "win32");
    const id = app.bundle_id ?? app.launch_path ?? app.name;
    await automation.run({ action: "launch", app: id });
    expect(call).toHaveBeenLastCalledWith("launch_app", args, undefined);
  });

  it("launches a macOS app found by its path through name", async () => {
    const path = "/Applications/Tool.app";
    const call = vi.fn<DriverCall>(async (name) =>
      name === "list_apps"
        ? reply("apps", { apps: [{ name: "Tool", launch_path: path, running: false }] })
        : reply("Launched."),
    );
    await new ComputerAutomation(call, () => [], "darwin").run({ action: "launch", app: path });
    expect(call).toHaveBeenLastCalledWith("launch_app", { name: path }, undefined);
  });

  it("snapshots the front window without a screenshot unless asked", async () => {
    const { automation, call } = fakeDriver();
    const result = await automation.run({ action: "snapshot", app: "com.apple.Notes" });
    expect(call).toHaveBeenLastCalledWith(
      "get_window_state",
      { pid: 101, window_id: 7, include_screenshot: false },
      undefined,
    );
    expect(result.text).toContain("AXButton (New Note)");
    expect(result.image).toBeUndefined();
  });

  it("refuses a window of another app", async () => {
    const { automation } = fakeDriver();
    await expect(
      automation.run({ action: "snapshot", app: "com.apple.Notes", window: 42 }),
    ).rejects.toThrow(/not a window of Notes/);
  });

  it("clicks a ref from the app's snapshot and returns what changed", async () => {
    const { automation, call } = fakeDriver();
    await automation.run({ action: "snapshot", app: "com.apple.Notes" });
    const result = await automation.run({
      action: "click",
      app: "com.apple.Notes",
      ref: "s00000001:1",
    });
    expect(call).toHaveBeenCalledWith(
      "click",
      { pid: 101, element_token: "s00000001:1" },
      undefined,
    );
    expect(call).toHaveBeenLastCalledWith(
      "get_window_state",
      { pid: 101, window_id: 7, since: "latest", include_screenshot: false },
      undefined,
    );
    expect(result.text).toContain("snapshot_id=s00000002");
    // The read after the click made the old snapshot stale.
    await expect(
      automation.run({ action: "click", app: "com.apple.Notes", ref: "s00000001:1" }),
    ).rejects.toThrow(/not from a snapshot of Notes/);
  });

  it("refuses refs it did not hand out", async () => {
    const { automation, call } = fakeDriver();
    await expect(
      automation.run({ action: "click", app: "com.apple.Notes", ref: "s000000ff:3" }),
    ).rejects.toThrow(/not from a snapshot/);
    expect(call.mock.calls.some(([name]) => name === "click")).toBe(false);
  });

  it("turns a driver refusal into an error", async () => {
    const { automation } = fakeDriver();
    await expect(
      automation.run({ action: "menu", app: "com.apple.Notes", path: ["File", "New"] }),
    ).rejects.toThrow("refused invoke_menu");
  });
});
