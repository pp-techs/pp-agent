import type { AgentEvent } from "@workspace/shared";
import type { HostOutput } from "./host-io.ts";

/** Where events go; the process that hosts the agent sets it once, before `init`. */
let output: HostOutput | null = null;

export function configureOutput(next: HostOutput): void {
  output = next;
}

/** Window in which repeated `sessions_changed` events are merged into one trailing event. */
const SESSIONS_CHANGED_COALESCE_MS = 250;

/** `null` outside a window; inside one, whether another `sessions_changed` arrived. */
let sessionsPending: boolean | null = null;

/**
 * Each client refetches the whole conversation list on `sessions_changed`, so a burst of them (the
 * steps of a turn, several chats or scheduled runs settling together) is sent as the first one at
 * once and a single trailing one when the window closes.
 */
function sessionsChanged(event: AgentEvent): void {
  if (sessionsPending !== null) {
    sessionsPending = true;
    return;
  }
  output?.emit(event);
  sessionsPending = false;
  setTimeout(() => {
    const pending = sessionsPending;
    sessionsPending = null;
    if (pending) sessionsChanged(event);
  }, SESSIONS_CHANGED_COALESCE_MS).unref();
}

/** Sends an event to every connected client. Events with nobody connected are dropped. */
export function emit(event: AgentEvent): void {
  if (event.type === "sessions_changed") sessionsChanged(event);
  else output?.emit(event);
}

/** Asks a client to open an http(s) URL in a browser. */
export function openUrl(url: string): void {
  output?.openUrl(url);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
