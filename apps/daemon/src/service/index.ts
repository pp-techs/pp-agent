import { homedir, userInfo } from "node:os";

import type { ServiceControl } from "@workspace/agent-core";
import type { ServiceManagerKind, ServiceStatus } from "@workspace/shared";

import { createLaunchdService } from "./launchd.ts";
import { execRunner } from "./runner.ts";
import { createSystemdService } from "./systemd.ts";
import { DEFAULT_SERVICE_LABEL } from "./types.ts";
import type { ServiceBackend, ServiceDeps, ServiceSpec } from "./types.ts";
import { createWindowsTaskService } from "./windows-task.ts";

export type { ServiceManagerKind, ServiceStatus };
export { DEFAULT_SERVICE_LABEL };

export interface ServiceOptions {
  /** Defaults to `com.pptechs.agentd`. */
  label?: string;
  /** Program the service manager starts (Node or the Electron binary). */
  execPath: string;
  /** Arguments after `execPath`, starting with the daemon script and `run`. */
  args: string[];
  env: Record<string, string>;
  logFile: string;
  /** Overrides for tests; the defaults describe this machine. */
  platform?: NodeJS.Platform;
  runner?: ServiceDeps["runner"];
  homeDir?: string;
  uid?: number | null;
  username?: string;
}

const BACKENDS: Partial<Record<NodeJS.Platform, ServiceBackend>> = {
  darwin: createLaunchdService,
  linux: createSystemdService,
  win32: createWindowsTaskService,
};

function unsupported(platform: NodeJS.Platform): ServiceControl {
  const detail = `Running in the background as a service is not supported on ${platform}.`;
  return {
    async status(): Promise<ServiceStatus> {
      return { supported: false, manager: null, installed: false, detail };
    },
    async install(): Promise<void> {
      throw new Error(detail);
    },
    async uninstall(): Promise<void> {
      throw new Error(detail);
    },
  };
}

/** The service control for this machine's service manager (launchd, systemd or Task Scheduler). */
export function createServiceControl(options: ServiceOptions): ServiceControl {
  const platform = options.platform ?? process.platform;
  const backend = BACKENDS[platform];
  if (!backend) return unsupported(platform);
  const spec: ServiceSpec = {
    label: options.label ?? DEFAULT_SERVICE_LABEL,
    execPath: options.execPath,
    args: options.args,
    env: options.env,
    logFile: options.logFile,
  };
  const deps: ServiceDeps = {
    runner: options.runner ?? execRunner,
    homeDir: options.homeDir ?? homedir(),
    uid: options.uid !== undefined ? options.uid : (process.getuid?.() ?? null),
    username: options.username ?? process.env.USER ?? userInfo().username,
  };
  return backend(spec, deps);
}
