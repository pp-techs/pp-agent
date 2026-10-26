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

export type ServiceBackend = (spec: ServiceSpec, deps: ServiceDeps) => ServiceControl;

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
