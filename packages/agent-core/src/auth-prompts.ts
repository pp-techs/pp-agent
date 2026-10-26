import { randomUUID } from "node:crypto";
import type { AuthPrompt } from "@workspace/shared";
import { emit } from "./ipc.ts";

/**
 * Questions a sign-in flow asks the person. Each one is sent as an `auth_prompt` event and settles
 * when the renderer answers with `respond_auth_prompt`, or when the flow itself drops it.
 */
export class AuthPrompts {
  private readonly open = new Map<string, (value: string | null) => void>();

  /**
   * Asks and resolves with the answer, or null when the person cancels or `signal` aborts (for
   * example when a browser callback finished the sign-in first).
   */
  ask(prompt: Omit<AuthPrompt, "promptId">, signal?: AbortSignal): Promise<string | null> {
    if (signal?.aborted) return Promise.resolve(null);
    const promptId = randomUUID();
    const { promise, resolve } = Promise.withResolvers<string | null>();
    const settle = (value: string | null) => {
      if (!this.open.delete(promptId)) return;
      signal?.removeEventListener("abort", onAbort);
      emit({ type: "auth_prompt_closed", promptId });
      resolve(value);
    };
    const onAbort = () => settle(null);
    signal?.addEventListener("abort", onAbort, { once: true });
    this.open.set(promptId, settle);
    emit({ type: "auth_prompt", prompt: { ...prompt, promptId } });
    return promise;
  }

  respond(promptId: string, value: string | null): void {
    this.open.get(promptId)?.(value);
  }
}
