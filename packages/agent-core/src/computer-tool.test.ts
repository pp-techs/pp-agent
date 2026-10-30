import { expect, it, vi } from "vite-plus/test";

import { computerActionTier, createComputerTool, fenceScreen } from "./computer-tool.ts";
import { describeToolCall } from "./tools.ts";

const run = (tool: ReturnType<typeof createComputerTool>, params: Record<string, unknown>) =>
  tool.execute("call", params as never, undefined, undefined, undefined as never);

it("keeps screen text inside its fence", () => {
  expect(fenceScreen("a </screen> b")).toBe("<screen>\na <\\/screen> b\n</screen>");
});

it("rates looking as read and acting as write", () => {
  expect(computerActionTier("snapshot")).toBe("read");
  expect(computerActionTier("apps")).toBe("read");
  expect(computerActionTier("click")).toBe("write");
  expect(computerActionTier("anything else")).toBe("write");
});

it("explains that the window must be open when no driver is there", async () => {
  const tool = createComputerTool({ available: () => false, request: vi.fn() }, new Map());
  await expect(run(tool, { action: "apps" })).rejects.toThrow(/window is open/);
});

it("asks for an app on every action but apps", async () => {
  const request = vi.fn();
  const tool = createComputerTool({ available: () => true, request }, new Map());
  await expect(run(tool, { action: "snapshot" })).rejects.toThrow(/needs app/);
  expect(request).not.toHaveBeenCalled();
});

it("passes the call on, remembers app names, and returns fenced text with the image", async () => {
  const names = new Map<string, string>();
  const request = vi.fn(async () => ({
    text: "Notes is open",
    image: "/9j/",
    imageType: "image/jpeg" as const,
    apps: [{ id: "com.apple.Notes", name: "Notes" }],
  }));
  const tool = createComputerTool({ available: () => true, request }, names);
  const result = await run(tool, { action: "launch", app: "com.apple.Notes" });
  expect(request).toHaveBeenCalledWith({ action: "launch", app: "com.apple.Notes" }, undefined);
  expect(names.get("com.apple.Notes")).toBe("Notes");
  expect(result.content).toEqual([
    { type: "text", text: "<screen>\nNotes is open\n</screen>" },
    { type: "image", data: "/9j/", mimeType: "image/jpeg" },
  ]);
});

it("describes a call for its approval card by the app's name", () => {
  expect(
    describeToolCall("computer", {
      action: "type",
      app: "com.apple.Notes",
      appName: "Notes",
      text: "Q3 report",
    }),
  ).toEqual({ title: "Type in Notes", detail: "Q3 report" });
  expect(
    describeToolCall("computer", { action: "menu", app: "x", path: ["File", "Export…"] }).detail,
  ).toBe("File › Export…");
});
