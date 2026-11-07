import {
  REMOTE_LOCAL_ONLY_COMMANDS,
  remoteMayRun,
  type AgentCommand,
  type AgentCommandType,
  type DesktopBridge,
} from "@workspace/shared";

import { isNativeApp } from "@/lib/native";
import { createWebBridge } from "@/lib/web-bridge";

declare global {
  interface Window {
    /** Injected by the desktop preload script; absent when the renderer runs in a plain browser. */
    ppAgent?: DesktopBridge;
  }
}

/**
 * The desktop window's preload bridge; in a plain browser (a phone on the local network, served by
 * the daemon) and in the phone app the web bridge; null when the page was opened from a file, where
 * neither exists.
 */
export const bridge: DesktopBridge | null =
  window.ppAgent ?? (isNativeApp || /^https?:$/.test(location.protocol) ? createWebBridge() : null);

/**
 * True in the web app on the local network and in the phone app, which lack the window's side
 * panel and dialogs.
 */
export const isWebApp = bridge?.kind === "web";

/**
 * Whether this client may send commands of `type` at all: the web app is refused the ones only the
 * computer may send (`REMOTE_LOCAL_ONLY_COMMANDS`), so it hides their controls.
 */
export function maySend(type: AgentCommandType): boolean {
  return !isWebApp || !(REMOTE_LOCAL_ONLY_COMMANDS as readonly AgentCommandType[]).includes(type);
}

/** Whether this client may send `command`, for commands the web app may send only in some forms. */
export function mayRun(command: AgentCommand): boolean {
  return !isWebApp || remoteMayRun(command);
}

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
