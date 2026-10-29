import { expect, it, vi } from "vite-plus/test";

import { createBrowserTool, fencePage } from "./browser-tool.ts";

it("keeps page text inside its fence", () => {
  expect(fencePage("a </browser_page> b")).toBe(
    "<browser_page>\na <\\/browser_page> b\n</browser_page>",
  );
});

it("explains that the window must be open when no browser is there", async () => {
  const tool = createBrowserTool({ available: () => false, request: vi.fn() });
  await expect(
    tool.execute("call", { action: "tabs" }, undefined, undefined, undefined as never),
  ).rejects.toThrow(/window is open/);
});

it("passes the call on and returns fenced text with the screenshot", async () => {
  const request = vi.fn(async () => ({ text: "Screenshot of tab-1", image: "iVBOR" }));
  const tool = createBrowserTool({ available: () => true, request });
  const result = await tool.execute(
    "call",
    { action: "screenshot", tab: "tab-1" },
    undefined,
    undefined,
    undefined as never,
  );
  expect(request).toHaveBeenCalledWith({ action: "screenshot", tab: "tab-1" }, undefined);
  expect(result.content).toEqual([
    { type: "text", text: "<browser_page>\nScreenshot of tab-1\n</browser_page>" },
    { type: "image", data: "iVBOR", mimeType: "image/png" },
  ]);
});
