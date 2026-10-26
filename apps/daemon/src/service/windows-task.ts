import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ServiceStatus } from "@workspace/shared";

import { DEFAULT_SERVICE_LABEL, firstLine } from "./types.ts";
import type { ServiceBackend, ServiceSpec } from "./types.ts";

const DEFAULT_TASK_NAME = "PP Agent Daemon";
const LAUNCHER_FILE = "pp-agentd-launch.ps1";

export function windowsTaskName(label: string): string {
  return label === DEFAULT_SERVICE_LABEL ? DEFAULT_TASK_NAME : label;
}

/** A PowerShell single-quoted string literal. */
export function powershellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Where the launcher script sits: next to the log, in the data folder the daemon owns. */
export function windowsLauncherPath(spec: ServiceSpec): string {
  return join(dirname(spec.logFile), LAUNCHER_FILE);
}

/**
 * The PowerShell script that sets the daemon's environment, runs it and appends its output to the
 * log. It is a file because `schtasks /TR` is limited to 261 characters.
 */
export function renderWindowsLauncher(spec: ServiceSpec): string {
  const env = Object.entries(spec.env).map(
    ([key, value]) =>
      `$env:${/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : `{${key}}`} = ${powershellQuote(value)}`,
  );
  const args = spec.args.map(powershellQuote).join(", ");
  return [
    "$ErrorActionPreference = 'Continue'",
    ...env,
    `$daemonArgs = @(${args})`,
    `& ${powershellQuote(spec.execPath)} @daemonArgs 2>&1 | Out-File -FilePath ${powershellQuote(spec.logFile)} -Append -Encoding utf8`,
    "",
  ].join("\r\n");
}

/** The `/TR` command of the scheduled task: a hidden PowerShell that runs the launcher script. */
export function renderTaskCommand(launcherPath: string): string {
  return `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${launcherPath}"`;
}

export function createTaskArguments(taskName: string, launcherPath: string): string[] {
  return [
    "/Create",
    "/SC",
    "ONLOGON",
    "/RL",
    "LIMITED",
    "/F",
    "/TN",
    taskName,
    "/TR",
    renderTaskCommand(launcherPath),
  ];
}

export const createWindowsTaskService: ServiceBackend = (spec, deps) => {
  const taskName = windowsTaskName(spec.label);
  const launcherPath = windowsLauncherPath(spec);

  async function query() {
    return deps.runner("schtasks", ["/Query", "/TN", taskName]);
  }

  return {
    async status(): Promise<ServiceStatus> {
      const base = { supported: true, manager: "windows-task" as const };
      try {
        const result = await query();
        if (result.code === 0) return { ...base, installed: true, detail: null };
        if (result.notFound) {
          return {
            supported: false,
            manager: "windows-task",
            installed: false,
            detail: "The Windows Task Scheduler (schtasks) was not found.",
          };
        }
        return { ...base, installed: false, detail: null };
      } catch (error) {
        return {
          ...base,
          installed: false,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async install(): Promise<void> {
      await mkdir(dirname(launcherPath), { recursive: true });
      // A BOM makes Windows PowerShell read the script as UTF-8, so non-ASCII paths survive.
      await writeFile(launcherPath, `\uFEFF${renderWindowsLauncher(spec)}`, "utf8");
      const created = await deps.runner("schtasks", createTaskArguments(taskName, launcherPath));
      if (created.code !== 0) {
        throw new Error(`Windows could not register the PP Agent task: ${firstLine(created)}`);
      }
      const started = await deps.runner("schtasks", ["/Run", "/TN", taskName]);
      if (started.code !== 0) {
        throw new Error(`Windows could not start the PP Agent task: ${firstLine(started)}`);
      }
    },

    async uninstall(): Promise<void> {
      const existing = await query();
      if (existing.code === 0) {
        const deleted = await deps.runner("schtasks", ["/Delete", "/TN", taskName, "/F"]);
        if (deleted.code !== 0) {
          throw new Error(`Windows could not remove the PP Agent task: ${firstLine(deleted)}`);
        }
      }
      await rm(launcherPath, { force: true });
    },
  };
};
