import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ServiceStatus } from "@workspace/shared";

import { DEFAULT_SERVICE_LABEL, firstLine } from "./types.ts";
import type { ServiceBackend, ServiceDeps, ServiceSpec } from "./types.ts";

const DEFAULT_UNIT_NAME = "pp-agentd.service";

export function systemdUnitName(label: string): string {
  return label === DEFAULT_SERVICE_LABEL ? DEFAULT_UNIT_NAME : `${label}.service`;
}

export function systemdUnitPath(homeDir: string, label: string): string {
  return join(homeDir, ".config", "systemd", "user", systemdUnitName(label));
}

/** Escapes `%` (unit specifiers) and, optionally, `$` (variable substitution in commands). */
function escapeSpecifiers(value: string, commandLine: boolean): string {
  const percent = value.replaceAll("%", "%%");
  return commandLine ? percent.replaceAll("$", "$$$$") : percent;
}

/** One word of a systemd command line: always double-quoted with C-style escapes. */
export function quoteSystemdWord(value: string): string {
  const escaped = escapeSpecifiers(value, true)
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");
  return `"${escaped}"`;
}

/** An `Environment=` assignment: the whole `KEY=value` is one quoted word. */
export function quoteSystemdEnvironment(key: string, value: string): string {
  const escaped = escapeSpecifiers(`${key}=${value}`, false)
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");
  return `"${escaped}"`;
}

/** The user unit that starts the daemon at login and restarts it whenever it stops. */
export function renderSystemdUnit(spec: ServiceSpec): string {
  const execStart = [spec.execPath, ...spec.args].map(quoteSystemdWord).join(" ");
  const environment = Object.entries(spec.env)
    .map(([key, value]) => `Environment=${quoteSystemdEnvironment(key, value)}`)
    .join("\n");
  if (/[\r\n\0]/.test(spec.logFile) || spec.logFile.endsWith("\\")) {
    throw new Error("The systemd log path cannot contain CR, LF, NUL, or a trailing backslash.");
  }
  const logTarget = `append:${escapeSpecifiers(spec.logFile, false)}`;
  return `[Unit]
Description=PP Agent background daemon

[Service]
Type=simple
ExecStart=${execStart}
${environment}${environment ? "\n" : ""}Restart=always
RestartSec=10
StandardOutput=${logTarget}
StandardError=${logTarget}

[Install]
WantedBy=default.target
`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const LINGER_HINT =
  "Linger is off for your account, so the service stops when you log out and only starts after you log in. Run `loginctl enable-linger` to keep it running without a login session.";

export const createSystemdService: ServiceBackend = (spec, deps) => {
  const unitName = systemdUnitName(spec.label);
  const unitPath = systemdUnitPath(deps.homeDir, spec.label);

  /** Why `systemctl --user` cannot be used here, or null when it works. */
  async function unavailableReason(): Promise<string | null> {
    const probe = await deps.runner("systemctl", ["--user", "show-environment"]);
    if (probe.code === 0) return null;
    if (probe.notFound) return "systemd is not available on this system (systemctl was not found).";
    return `systemd user services are not available here (no user session bus, as in a container or an SSH session without a login): ${firstLine(probe)}`;
  }

  async function lingerHint(deps_: ServiceDeps): Promise<string | null> {
    const linger = await deps_.runner("loginctl", ["show-user", deps_.username, "-p", "Linger"]);
    if (linger.code !== 0) return null;
    return /^Linger=no\s*$/m.test(linger.stdout) ? LINGER_HINT : null;
  }

  async function requireAvailable(): Promise<void> {
    const reason = await unavailableReason();
    if (reason) throw new Error(reason);
  }

  async function systemctl(args: string[], action: string): Promise<void> {
    const result = await deps.runner("systemctl", ["--user", ...args]);
    if (result.code !== 0) {
      throw new Error(`systemd could not ${action} the PP Agent service: ${firstLine(result)}`);
    }
  }

  return {
    async status(): Promise<ServiceStatus> {
      try {
        const reason = await unavailableReason();
        if (reason)
          return { supported: false, manager: "systemd", installed: false, detail: reason };
        const base = { supported: true, manager: "systemd" as const };
        if (!(await exists(unitPath))) return { ...base, installed: false, detail: null };
        const enabled = await deps.runner("systemctl", ["--user", "is-enabled", unitName]);
        if (enabled.code !== 0) {
          return {
            ...base,
            installed: false,
            detail: `The service file exists but is not enabled: ${firstLine(enabled)}`,
          };
        }
        return { ...base, installed: true, detail: await lingerHint(deps) };
      } catch (error) {
        return {
          supported: true,
          manager: "systemd",
          installed: false,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async install(): Promise<void> {
      await requireAvailable();
      await mkdir(dirname(unitPath), { recursive: true });
      await mkdir(dirname(spec.logFile), { recursive: true });
      await writeFile(unitPath, renderSystemdUnit(spec), { encoding: "utf8", mode: 0o644 });
      await systemctl(["daemon-reload"], "reload its units for");
      await systemctl(["enable", "--now", unitName], "enable");
      // `enable --now` leaves an already-running old instance alone; restart picks up new arguments.
      await systemctl(["restart", unitName], "restart");
    },

    async uninstall(): Promise<void> {
      await requireAvailable();
      // Disabling a unit that was never installed fails; that is the state we want anyway.
      if (await exists(unitPath)) await systemctl(["disable", "--now", unitName], "disable");
      await rm(unitPath, { force: true });
      await systemctl(["daemon-reload"], "reload its units for");
    },
  };
};
