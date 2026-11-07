import type { BrowserProfile } from "@workspace/shared";
import { describe, expect, it, vi } from "vite-plus/test";

import type { BrowserAutomationOptions } from "./automation.ts";

vi.mock("electron", () => ({}));

const { BrowserAutomation, formatSnapshot, parseKey } = await import("./automation.ts");

/** A browser with one tab, and an address check that calls only 10.0.0.1 private. */
function fakeBrowser() {
  const tab = {
    id: "tab-1",
    profileId: "default",
    url: "https://example.com/",
    title: "Example",
    loading: false,
    canGoBack: false,
    canGoForward: false,
  };
  const host = {
    state: () => ({ tabs: [tab], activeId: "tab-1" }),
    open: vi.fn(async () => tab),
    close: vi.fn(),
    activate: vi.fn(),
    navigate: vi.fn(),
    go: vi.fn(),
    evaluate: vi.fn(async (): Promise<unknown> => {
      throw new Error("page crashed");
    }),
    contentsOf: vi.fn(),
    drive: vi.fn(),
    release: vi.fn(),
  };
  const automation = new BrowserAutomation({
    // Only the host methods the steps under test reach.
    host: host as unknown as BrowserAutomationOptions["host"],
    isPrivate: async (url) => new URL(url).hostname === "10.0.0.1",
    profiles: async () => [{ id: "default", name: "Default" } as BrowserProfile],
    reveal: () => {},
  });
  return { host, automation };
}

describe("BrowserAutomation", () => {
  it("refuses to open or navigate to this computer or the local network", async () => {
    const { host, automation } = fakeBrowser();
    await expect(automation.run({ action: "open", url: "http://10.0.0.1/admin" })).rejects.toThrow(
      /local network/,
    );
    await expect(automation.run({ action: "navigate", url: "10.0.0.1:8080" })).rejects.toThrow(
      /local network/,
    );
    expect(host.open).not.toHaveBeenCalled();
    expect(host.navigate).not.toHaveBeenCalled();
  });

  it("drives the tab it acts on and releases it, also when the step fails", async () => {
    const { host, automation } = fakeBrowser();
    await expect(automation.run({ action: "eval", expression: "1" })).rejects.toThrow(
      "page crashed",
    );
    expect(host.drive).toHaveBeenCalledWith("tab-1");
    expect(host.release).toHaveBeenCalledWith("tab-1");
  });
});

describe("parseKey", () => {
  it("maps named keys and adds the character Enter types", () => {
    expect(parseKey("Enter")).toEqual({ keyCode: "Enter", modifiers: [], char: "\r" });
    expect(parseKey("ArrowDown")).toEqual({ keyCode: "Down", modifiers: [] });
    expect(parseKey("Escape")).toEqual({ keyCode: "Escape", modifiers: [] });
  });

  it("reads modifiers and leaves out the character of a shortcut", () => {
    expect(parseKey("Control+A")).toEqual({ keyCode: "A", modifiers: ["control"] });
    expect(parseKey("cmd+shift+z")).toEqual({ keyCode: "z", modifiers: ["meta", "shift"] });
    expect(parseKey("Control++")).toEqual({ keyCode: "+", modifiers: ["control"] });
  });

  it("types a single character", () => {
    expect(parseKey("a")).toEqual({ keyCode: "a", modifiers: [], char: "a" });
  });

  it("refuses unknown keys", () => {
    expect(() => parseKey("Hyper")).toThrow(/Unknown key/);
  });
});

it("formats a snapshot with its tab, profile, page and a note when cut short", () => {
  const text = formatSnapshot(
    {
      id: "tab-2",
      profileId: "default",
      url: "https://example.com/",
      title: "Example",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    },
    "Default",
    {
      title: "Example",
      url: "https://example.com/",
      lines: ['- heading "Example" [level=1]', '- link "More" [ref=e1] -> /more'],
      truncated: true,
      scrollY: 0,
      height: 1200,
      viewport: 800,
    },
  );
  expect(text).toContain("Tab tab-2 (profile Default)");
  expect(text).toContain("URL: https://example.com/");
  expect(text).toContain('- link "More" [ref=e1] -> /more');
  expect(text).toContain("[The snapshot stops here");
});
