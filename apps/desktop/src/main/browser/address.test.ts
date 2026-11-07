import { describe, expect, it } from "vite-plus/test";

import { chromeUserAgent, isPrivateTarget, isWebUrl, toAddress } from "./address.ts";

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

describe("isPrivateTarget", () => {
  const resolve = async (host: string) =>
    host === "router.example"
      ? [{ address: "203.0.113.9" }, { address: "192.168.1.1" }]
      : host === "public.example"
        ? [{ address: "93.184.216.34" }]
        : Promise.reject(new Error("ENOTFOUND"));

  it.each([
    "http://127.0.0.1:3000/",
    "http://10.0.0.8/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[fe80::1]/",
    "http://0x7f.1/",
    "http://localhost:47821/",
    "http://app.localhost/",
    "http://router.example/",
  ])("refuses %s", async (url) => {
    expect(await isPrivateTarget(url, resolve)).toBe(true);
  });

  it.each([
    "https://public.example/",
    "https://8.8.8.8/",
    "https://missing.example/",
    "about:blank",
  ])("allows %s", async (url) => {
    expect(await isPrivateTarget(url, resolve)).toBe(false);
  });
});

it("reports a plain Chrome user agent", () => {
  const agent = chromeUserAgent("darwin", "140.0.7339.41");
  expect(agent).toContain("Chrome/140.0.0.0");
  expect(agent).toContain("Macintosh");
  expect(agent).not.toContain("Electron");
});
