import type { BrowserAction, BrowserState, BrowserTab } from "@workspace/shared";
import type { PortableCookie } from "./cookies/portable.ts";

/**
 * What browser automation needs from a browser, by tab id and profile id. The side panel's
 * `BrowserHost` implements it with Electron views; a headless Chromium the daemon starts could
 * implement it too, so the agent's future browser tools need not know which one runs (the panel
 * while the window is open, the background one when it is not).
 */
export interface BrowserDriver {
  state(): BrowserState;
  open(profileId: string, url?: string): Promise<BrowserTab>;
  close(tabId: string): Promise<void>;
  navigate(tabId: string, input: string): Promise<void>;
  go(tabId: string, action: BrowserAction): Promise<void>;
  /** Runs JavaScript in the page and returns its (JSON-compatible) result. */
  evaluate(tabId: string, expression: string): Promise<unknown>;
  /** PNG of the visible part of the page. */
  screenshot(tabId: string): Promise<Buffer>;
  /** Adds cookies to a profile; `refused` counts those the engine did not accept. */
  setCookies(
    profileId: string,
    cookies: readonly PortableCookie[],
  ): Promise<{ written: number; refused: number }>;
}
