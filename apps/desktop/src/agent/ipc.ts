import type { AgentEvent, AgentToMainMessage } from "@workspace/shared";

/** Messages to the main process, which forwards events to the renderer. */
export function send(message: AgentToMainMessage): void {
  process.parentPort.postMessage(message);
}

export function emit(event: AgentEvent): void {
  send({ kind: "event", event });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
