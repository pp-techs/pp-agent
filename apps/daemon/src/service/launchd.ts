import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ServiceStatus } from "@workspace/shared";

import { firstLine } from "./types.ts";
import type { ServiceBackend, ServiceSpec } from "./types.ts";

/** Seconds launchd waits before it restarts a daemon that exited. */
const THROTTLE_SECONDS = 10;

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** The LaunchAgent property list that starts the daemon at login and keeps it running. */
export function renderLaunchdPlist(spec: ServiceSpec): string {
  const programArguments = [spec.execPath, ...spec.args]
    .map((argument) => `    <string>${xmlEscape(argument)}</string>`)
    .join("\n");
  const environment = Object.entries(spec.env)
    .map(
      ([key, value]) =>
        `    <key>${xmlEscape(key)}</key>\n    <string>${xmlEscape(value)}</string>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(spec.label)}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${environment}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>${THROTTLE_SECONDS}</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(spec.logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(spec.logFile)}</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
}

export function launchdPlistPath(homeDir: string, label: string): string {
  return join(homeDir, "Library", "LaunchAgents", `${label}.plist`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export const createLaunchdService: ServiceBackend = (spec, deps) => {
  const plistPath = launchdPlistPath(deps.homeDir, spec.label);

  function domain(): string {
    if (deps.uid === null) throw new Error("Cannot find your user id to register with launchd.");
    return `gui/${deps.uid}`;
  }

  /** Unloads the job; "not loaded" and every other failure are fine because the job may be absent. */
  async function bootout(): Promise<void> {
    await deps.runner("launchctl", ["bootout", `${domain()}/${spec.label}`]);
  }

  return {
    async status(): Promise<ServiceStatus> {
      const base = { supported: true, manager: "launchd" as const };
      try {
        if (!(await exists(plistPath))) return { ...base, installed: false, detail: null };
        const loaded = await deps.runner("launchctl", ["print", `${domain()}/${spec.label}`]);
        if (loaded.code === 0) return { ...base, installed: true, detail: null };
        return {
          ...base,
          installed: false,
          detail: `The LaunchAgent file exists but is not loaded: ${firstLine(loaded)}`,
        };
      } catch (error) {
        return {
          ...base,
          installed: false,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async install(): Promise<void> {
      const target = domain();
      await mkdir(dirname(plistPath), { recursive: true });
      await mkdir(dirname(spec.logFile), { recursive: true });
      await writeFile(plistPath, renderLaunchdPlist(spec), { encoding: "utf8", mode: 0o644 });
      await bootout();
      const bootstrap = await deps.runner("launchctl", ["bootstrap", target, plistPath]);
      if (bootstrap.code !== 0) {
        throw new Error(`launchd could not load the PP Agent service: ${firstLine(bootstrap)}`);
      }
      const kickstart = await deps.runner("launchctl", [
        "kickstart",
        "-k",
        `${target}/${spec.label}`,
      ]);
      if (kickstart.code !== 0) {
        throw new Error(`launchd could not start the PP Agent service: ${firstLine(kickstart)}`);
      }
    },

    async uninstall(): Promise<void> {
      await bootout();
      await rm(plistPath, { force: true });
    },
  };
};
