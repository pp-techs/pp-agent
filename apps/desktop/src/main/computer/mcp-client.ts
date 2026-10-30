import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";

/** What an MCP `tools/call` returns, as far as the app reads it. */
export interface McpToolResult {
  content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  >;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

const PROTOCOL_VERSION = "2025-06-18";

/**
 * A minimal MCP client over a child's stdin/stdout (newline-delimited JSON-RPC): `initialize`,
 * then `tools/call`. Enough for cua-driver, whose tools the app calls by name; anything the server
 * sends besides responses (logs, progress) is ignored.
 */
export class StdioMcpClient {
  private readonly child: ChildProcess;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private exitError: Error | null = null;
  /** Settles when the child exits, for whatever reason. */
  readonly exited: Promise<void>;

  constructor(
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    log: (line: string) => void,
  ) {
    this.child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const exited = Promise.withResolvers<void>();
    this.exited = exited.promise;
    createInterface({ input: this.child.stdout! }).on("line", (line) => this.receive(line));
    createInterface({ input: this.child.stderr! }).on("line", log);
    // Writing to a child that died raises EPIPE on stdin; the exit handler reports it.
    this.child.stdin!.on("error", () => undefined);
    this.child.once("error", (error) => this.fail(error));
    this.child.once("exit", (code, signal) => {
      this.fail(new Error(`cua-driver stopped (${signal ?? `exit code ${code}`}).`));
      exited.resolve();
    });
  }

  get running(): boolean {
    return this.exitError === null;
  }

  async initialize(clientName: string, clientVersion: string): Promise<void> {
    await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: clientName, version: clientVersion },
    });
    this.notify("notifications/initialized");
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpToolResult> {
    return (await this.request("tools/call", { name, arguments: args }, signal)) as McpToolResult;
  }

  /** Ends stdin (the server shuts down on EOF) and kills the child if it lingers. */
  async close(graceMs = 2000): Promise<void> {
    if (!this.running) return;
    this.child.stdin!.end();
    const timer = setTimeout(() => this.child.kill(), graceMs);
    await this.exited;
    clearTimeout(timer);
  }

  private request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.exitError) return Promise.reject(this.exitError);
    if (signal?.aborted) return Promise.reject(new Error("The step was stopped."));
    const id = this.nextId++;
    const result = Promise.withResolvers<unknown>();
    const onAbort = () => {
      if (!this.pending.delete(id)) return;
      this.notify("notifications/cancelled", { requestId: id, reason: "stopped" });
      result.reject(new Error("The step was stopped."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    this.pending.set(id, result);
    this.write({ jsonrpc: "2.0", id, method, params });
    return result.promise.finally(() => signal?.removeEventListener("abort", onAbort));
  }

  private notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
  }

  private write(message: unknown): void {
    if (this.running) this.child.stdin!.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line: string): void {
    let message: { id?: unknown; result?: unknown; error?: { message?: unknown } };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    const error = message.error?.message;
    if (message.error) pending.reject(new Error(typeof error === "string" ? error : "MCP error"));
    else pending.resolve(message.result);
  }

  private fail(error: Error): void {
    this.exitError ??= error;
    for (const pending of this.pending.values()) pending.reject(this.exitError);
    this.pending.clear();
  }
}
