import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("electron", () => ({}));

const { formatSnapshot, parseKey } = await import("./automation.ts");

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
