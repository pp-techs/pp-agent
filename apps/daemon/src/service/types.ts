import { readFile } from "node:fs/promises";

import type { ServiceControl } from "@workspace/agent-core";

/** Default service label; also names the launchd job. */
export const DEFAULT_SERVICE_LABEL = "com.pptechs.agentd";

/** How the daemon is started by the OS service manager. */
export interface ServiceSpec {
  label: string;
  execPath: string;
  args: string[];
  env: Record<string, string>;
  /** Receives the daemon's stdout and stderr while it runs as a service. */
  logFile: string;
}

export interface CommandResult {
  /** Exit code; -1 when the program could not be started at all. */
  code: number;
  stdout: string;
  stderr: string;
  /** True when the program does not exist on this machine. */
  notFound: boolean;
}

/** Runs a program with an argument vector (never a shell string); it resolves even on failure. */
export type CommandRunner = (file: string, args: string[]) => Promise<CommandResult>;

/** Machine facts the backends need, injectable so the flows are testable. */
export interface ServiceDeps {
  runner: CommandRunner;
  homeDir: string;
  /** Numeric user id (launchd domain); null where the platform has none. */
  uid: number | null;
  username: string;
}

/** The agent's service control plus what the daemon itself needs from the service manager. */
export interface DaemonService extends ServiceControl {
  /**
   * Starts the installed service now, so it takes over after a daemon the app started stops.
   * Does nothing when the service is not installed.
   */
  startIfInstalled(): Promise<void>;
  /**
   * Brings an installed service's file up to date with what this build writes (a fix to the
   * restart rule, a new environment variable or version) without starting a daemon. Only touches
   * a service that runs this same program and script, so a development build leaves an installed
   * release alone. Resolves true when it rewrote the file. Must not be called by the service's
   * own daemon: reloading the job would stop it.
   */
  refreshIfOutdated(): Promise<boolean>;
}

export type ServiceBackend = (spec: ServiceSpec, deps: ServiceDeps) => DaemonService;

/** First non-empty line of a command's output, for error messages. */
export function firstLine(result: CommandResult): string {
  const text = `${result.stderr}\n${result.stdout}`;
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? `exit code ${result.code}`
  );
}

/** A UTF-8 text file's contents, or null when it cannot be read (absent). */
export async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}
