import type { BrowserWindow, WebFrameMain } from "electron";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("electron", () => ({ ipcMain: {} }));

const { appPageMatcher, isTrustedSender } = await import("./trusted-ipc.ts");

const frame = (processId: number, routingId: number, url: string) =>
  ({ processId, routingId, url }) as unknown as WebFrameMain;

function windowWith(main: WebFrameMain, destroyed = false): BrowserWindow {
  // Only the fields the guard reads.
  return {
    webContents: { isDestroyed: () => destroyed, mainFrame: main },
  } as unknown as BrowserWindow;
}

describe("isTrustedSender", () => {
  const isApp = appPageMatcher(null, "file:///Applications/PP%20Agent.app/renderer/index.html");
  const main = frame(4, 1, "file:///Applications/PP%20Agent.app/renderer/index.html#/chat");

  it("answers the main frame of the window on the app's page", () => {
    expect(isTrustedSender(main, windowWith(main), isApp)).toBe(true);
  });

  it("refuses other frames, other pages and a missing window", () => {
    expect(isTrustedSender(frame(4, 7, main.url), windowWith(main), isApp)).toBe(false);
    expect(isTrustedSender(frame(9, 1, main.url), windowWith(main), isApp)).toBe(false);
    const elsewhere = frame(4, 1, "file:///Users/me/Documents/PP%20Agent/x.html");
    expect(isTrustedSender(elsewhere, windowWith(elsewhere), isApp)).toBe(false);
    expect(isTrustedSender(main, null, isApp)).toBe(false);
    expect(isTrustedSender(main, windowWith(main, true), isApp)).toBe(false);
    expect(isTrustedSender(null, windowWith(main), isApp)).toBe(false);
  });

  it("matches the dev server by origin", () => {
    const dev = appPageMatcher("http://localhost:47821", "file:///unused/index.html");
    expect(dev("http://localhost:47821/#/settings")).toBe(true);
    expect(dev("http://localhost:3000/")).toBe(false);
    expect(dev("https://example.com/")).toBe(false);
  });
});
