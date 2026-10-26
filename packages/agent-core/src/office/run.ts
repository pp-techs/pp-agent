/**
 * Runs the bundled OfficeCLI binary. It never goes through a shell, starts with a scrubbed
 * environment, and is told not to update itself, install anything, or keep a background process
 * (`OFFICECLI_NO_AUTO_RESIDENT`), so there is nothing to clean up when a run ends or is stopped.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Wall-clock limit for one command. */
const TIMEOUT_MS = 120_000;
/** Bytes kept from the command's output; the rest is dropped and the command stopped. */
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

/** Variables a command may inherit. Credentials, proxies and API keys are not among them. */
const INHERITED_ENV = [
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "SYSTEMROOT",
  "windir",
  "COMSPEC",
  "PATHEXT",
  "DISPLAY",
  "WAYLAND_DISPLAY",
];

/** `mac-arm64`, `win-x64`, `linux-x64`: the folder name under `resources/officecli/`. */
export function platformKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  const os = platform === "darwin" ? "mac" : platform === "win32" ? "win" : "linux";
  return `${os}-${arch}`;
}

let configuredResourcesDir: string | null = null;

/** Folder the host was told holds the app's resources (`AgentPaths.resourcesDir`). */
export function configureResourcesDir(dir: string | undefined): void {
  configuredResourcesDir = dir ?? null;
}

/**
 * A folder shipped with the app (`extraResources`): the configured resources folder first, then
 * `process.resourcesPath` (Electron), then `apps/desktop/resources` when running from a bundle in
 * `apps/desktop/dist` or from source in development.
 */
export function resourcePath(...parts: string[]): string | null {
  // Set by Electron only; this package does not depend on its types.
  const { resourcesPath } = process as NodeJS.Process & { resourcesPath?: string };
  const roots = [
    configuredResourcesDir ? join(configuredResourcesDir, ...parts) : null,
    resourcesPath ? join(resourcesPath, ...parts) : null,
    // Bundled: dist/daemon.mjs sits next to apps/desktop/resources.
    join(import.meta.dirname, "..", "resources", ...parts),
    // From source: packages/agent-core/src/office.
    join(import.meta.dirname, "..", "..", "..", "..", "apps", "desktop", "resources", ...parts),
  ];
  return roots.find((root): root is string => root !== null && existsSync(root)) ?? null;
}

export function officeCliBinary(): string | null {
  const name = process.platform === "win32" ? "officecli.exe" : "officecli";
  return resourcePath("officecli", platformKey(), name);
}

export interface OfficeCliOptions {
  /** Working directory; the workspace. */
  cwd: string;
  /** Private home for the binary's own files (settings, state), away from the user's real home. */
  homeDir: string;
  argv: readonly string[];
  /** Sent on standard input (batch operations). */
  stdin?: string;
  signal?: AbortSignal | undefined;
  /** Replaces the bundled binary; tests only. */
  binary?: string;
  /** Environment to start from; tests only. */
  baseEnv?: NodeJS.ProcessEnv;
}

export interface OfficeCliResult {
  exitCode: number;
  output: string;
}

export function officeCliEnv(homeDir: string, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of INHERITED_ENV) if (base[name] !== undefined) env[name] = base[name];
  return {
    ...env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    APPDATA: join(homeDir, "AppData", "Roaming"),
    LOCALAPPDATA: join(homeDir, "AppData", "Local"),
    XDG_CONFIG_HOME: join(homeDir, ".config"),
    XDG_DATA_HOME: join(homeDir, ".local", "share"),
    XDG_CACHE_HOME: join(homeDir, ".cache"),
    OFFICECLI_STATE_DIR: join(homeDir, "state"),
    // No update check, no self-install into other tools' folders, no background resident process.
    OFFICECLI_SKIP_UPDATE: "1",
    OFFICECLI_NO_AUTO_INSTALL: "1",
    OFFICECLI_NO_AUTO_RESIDENT: "1",
    DOTNET_CLI_TELEMETRY_OPTOUT: "1",
    DOTNET_NOLOGO: "1",
  };
}

export async function runOfficeCli(options: OfficeCliOptions): Promise<OfficeCliResult> {
  const binary = options.binary ?? officeCliBinary();
  if (!binary)
    throw new Error(
      `OfficeCLI is not included in this build (no binary for ${platformKey()}). Run \`node scripts/fetch-officecli.ts\` when developing.`,
    );
  await mkdir(options.homeDir, { recursive: true });
  const env = officeCliEnv(options.homeDir, options.baseEnv ?? process.env);
  await mkdir(env.OFFICECLI_STATE_DIR ?? options.homeDir, { recursive: true });

  return new Promise<OfficeCliResult>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error("Stopped."));
      return;
    }
    const child = spawn(binary, [...options.argv], {
      cwd: options.cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let dropped = false;
    let stoppedBy: "timeout" | "abort" | null = null;
    const stop = (reason: NonNullable<typeof stoppedBy>) => {
      stoppedBy ??= reason;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => stop("timeout"), TIMEOUT_MS);
    const onAbort = () => stop("abort");
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const collect = (chunk: Buffer) => {
      if (size >= MAX_OUTPUT_BYTES) {
        dropped = true;
        child.kill("SIGKILL");
        return;
      }
      chunks.push(chunk);
      size += chunk.length;
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.stdin ?? "");
    const finish = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    };
    child.on("error", (error) => {
      finish();
      reject(error);
    });
    child.on("close", (code) => {
      finish();
      if (stoppedBy === "abort") return reject(new Error("Stopped."));
      if (stoppedBy === "timeout")
        return reject(new Error(`OfficeCLI did not finish within ${TIMEOUT_MS / 1000} seconds.`));
      let output = Buffer.concat(chunks).toString("utf8");
      if (dropped) output += "\n[Output cut off at 2 MB.]";
      resolve({ exitCode: code ?? 1, output });
    });
  });
}

/** Creates the parent folders of files a command will write. */
export async function prepareOutputs(outputs: readonly string[]): Promise<void> {
  for (const output of outputs) await mkdir(dirname(output), { recursive: true });
}
