import { describe, expect, it } from "vite-plus/test";

import { chromeUserAgent, isWebUrl, toAddress } from "./address.ts";

describe("toAddress", () => {
  it("keeps web addresses", () => {
    expect(toAddress("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(toAddress("  http://example.com ")).toBe("http://example.com");
  });

  it("adds https to a host, and http for this computer", () => {
    expect(toAddress("example.com")).toBe("https://example.com");
    expect(toAddress("sub.example.co/path?q=1")).toBe("https://sub.example.co/path?q=1");
    expect(toAddress("localhost:3000/app")).toBe("http://localhost:3000/app");
  });

  it("searches for anything else", () => {
    expect(toAddress("cookie import chrome")).toBe(
      "https://www.google.com/search?q=cookie%20import%20chrome",
    );
    expect(toAddress("javascript:alert(1)")).toMatch(/^https:\/\/www\.google\.com\/search/);
    expect(toAddress("")).toBe("about:blank");
  });
});

it("allows only web schemes", () => {
  expect(isWebUrl("https://example.com")).toBe(true);
  expect(isWebUrl("about:blank")).toBe(true);
  expect(isWebUrl("file:///etc/passwd")).toBe(false);
  expect(isWebUrl("javascript:alert(1)")).toBe(false);
  expect(isWebUrl("not a url")).toBe(false);
});

it("reports a plain Chrome user agent", () => {
  const agent = chromeUserAgent("darwin", "140.0.7339.41");
  expect(agent).toContain("Chrome/140.0.0.0");
  expect(agent).toContain("Macintosh");
  expect(agent).not.toContain("Electron");
});
