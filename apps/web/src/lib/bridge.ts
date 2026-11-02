import type { DesktopBridge } from "@workspace/shared";

declare global {
  interface Window {
    /** Injected by the desktop preload script; absent when the renderer runs in a plain browser. */
    ppAgent?: DesktopBridge;
  }
}

export const bridge = window.ppAgent ?? null;

/** Hands errors nobody handled to the audit log, so a bug report can show them. */
if (bridge) {
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
