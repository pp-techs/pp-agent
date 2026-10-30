import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type McpToolResult, StdioMcpClient } from "./mcp-client.ts";

/** A driver nobody used for this long is stopped; the next step starts it again. */
const IDLE_MS = 10 * 60_000;

/** Where `scripts/fetch-cua-driver.mjs` puts the binary for this platform, or null when it did not. */
export function findCuaDriver(resourcesDir: string): string | null {
  if (process.platform !== "darwin" && process.platform !== "win32") return null;
  const os = process.platform === "darwin" ? "mac" : "win";
  const name = process.platform === "win32" ? "cua-driver.exe" : "cua-driver";
  const path = join(resourcesDir, "cua-driver", `${os}-${process.arch}`, name);
  return existsSync(path) ? path : null;
}

export interface CuaDriverOptions {
  binary: string;
  /** Folder the driver keeps its settings and state in (macOS); `<userData>/cua-driver`. */
  home: string;
  /** PP Agent's bundle id, echoed by the driver's permission reports. */
  hostBundleId: string;
  appVersion: string;
  log: (line: string) => void;
}

/**
 * cua-driver as a child of the main process, spoken to over MCP (`cua-driver mcp --embedded
 * --direct`): the child owns the automation runtime, and because main spawns it directly macOS
 * answers its Accessibility and Screen Recording checks with PP Agent's own grants. Started on the
 * first step, stopped after a while without steps and when the app quits.
 */
export class CuaDriver {
  private client: StdioMcpClient | null = null;
  private starting: Promise<StdioMcpClient> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: CuaDriverOptions) {}

  async call(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpToolResult> {
    const client = await this.ready();
    this.touch();
    try {
      return await client.callTool(name, args, signal);
    } finally {
      this.touch();
    }
  }

  /** Stops the driver; the next step starts a new one (after a permission change, on quit). */
  async stop(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const client = this.client ?? (await this.starting?.catch(() => null)) ?? null;
    this.client = null;
    this.starting = null;
    await client?.close();
  }

  private ready(): Promise<StdioMcpClient> {
    if (this.client?.running) return Promise.resolve(this.client);
    this.client = null;
    this.starting ??= this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async start(): Promise<StdioMcpClient> {
    const { binary, home, hostBundleId, appVersion } = this.options;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CUA_DRIVER_EMBEDDED: "1",
      CUA_DRIVER_HOST_BUNDLE_ID: hostBundleId,
    };
    // On macOS the driver keeps its settings in ~/.cua-driver; a home of its own keeps them apart
    // from a cua-driver the person installed. Apps it launches go through LaunchServices and do
    // not inherit this. Windows resolves the profile folder without HOME, so it stays shared there.
    if (process.platform === "darwin") env.HOME = home;
    disableTelemetry(process.platform === "darwin" ? home : homedir());
    const client = new StdioMcpClient(
      binary,
      ["mcp", "--embedded", "--direct", "--host-bundle-id", hostBundleId],
      env,
      (line) => this.options.log(`cua-driver: ${line}`),
    );
    try {
      await client.initialize("pp-agent", appVersion);
    } catch (error) {
      await client.close(0);
      throw error;
    }
    void client.exited.then(() => {
      if (this.client === client) this.client = null;
    });
    this.client = client;
    return client;
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.stop(), IDLE_MS);
    this.idleTimer.unref();
  }
}

/**
 * cua-driver sends anonymous usage telemetry unless its settings say otherwise. Where it has no
 * settings yet, write them with telemetry off; settings the person made themselves are kept.
 */
function disableTelemetry(home: string): void {
  const dir = join(home, ".cua-driver");
  const file = join(dir, "config.json");
  if (existsSync(file)) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify({ telemetry_enabled: false }, null, 2)}\n`);
}
