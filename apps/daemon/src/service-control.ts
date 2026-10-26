import type { ServiceControl } from "@workspace/agent-core";
import type { DaemonPaths } from "./paths.ts";
import { createServiceControl } from "./service/index.ts";

/** Variables the service manager must hand to the daemon so it finds the same data and resources. */
const SERVICE_ENV = [
  "ELECTRON_RUN_AS_NODE",
  "PP_AGENT_HOME",
  "PP_AGENT_RESOURCES",
  "PP_AGENT_WORKSPACE",
  "PP_AGENT_VERSION",
] as const;

/** Service control for this very install: the service runs `<this runtime> <this script> run`. */
export function serviceControlFor(paths: DaemonPaths): ServiceControl {
  const env: Record<string, string> = {};
  for (const name of SERVICE_ENV) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  // A custom home must reach the service too, or it would manage another set of data.
  env.PP_AGENT_HOME = paths.home;
  return createServiceControl({
    execPath: process.execPath,
    args: [process.argv[1] ?? "", "run"],
    env,
    logFile: paths.logFile,
  });
}
