import type { DesktopBridge } from "@workspace/shared";

import { createWebBridge } from "@/lib/web-bridge";

declare global {
  interface Window {
    /** Injected by the desktop preload script; absent when the renderer runs in a plain browser. */
    ppAgent?: DesktopBridge;
  }
}

/**
 * The desktop window's preload bridge; in a plain browser (a phone on the local network, served by
 * the daemon) the web bridge; null when the page was opened from a file, where neither exists.
 */
export const bridge: DesktopBridge | null =
  window.ppAgent ?? (/^https?:$/.test(location.protocol) ? createWebBridge() : null);

/** True in the web app on the local network, which lacks the window's side panel and dialogs. */
export const isWebApp = bridge?.kind === "web";

/** Hands errors nobody handled to the audit log, so a bug report can show them. */
if (bridge?.kind === "desktop") {
  window.addEventListener("error", (event) => {
    bridge.diagnostics.report({
      kind: "error",
      message: event.message,
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    bridge.diagnostics.report({
      kind: "unhandledrejection",
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}
