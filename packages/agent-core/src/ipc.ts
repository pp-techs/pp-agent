import type { AgentEvent } from "@workspace/shared";
import type { HostOutput } from "./host-io.ts";

/** Where events go; the process that hosts the agent sets it once, before `init`. */
let output: HostOutput | null = null;

export function configureOutput(next: HostOutput): void {
  output = next;
}

/** Sends an event to every connected client. Events with nobody connected are dropped. */
export function emit(event: AgentEvent): void {
  output?.emit(event);
}

/** Asks a client to open an http(s) URL in a browser. */
export function openUrl(url: string): void {
  output?.openUrl(url);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
