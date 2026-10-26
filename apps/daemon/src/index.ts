/**
 * pp-agentd: `run` (default) hosts the agent; `install`, `uninstall`, `status` manage the login
 * service. Started by the desktop app, a service manager, or a terminal.
 *
 * The branches import lazily on purpose: `status` and `install` must not load the Pi SDK.
 */
import { resolveDaemonPaths } from "./paths.ts";

const command = process.argv[2] ?? "run";

switch (command) {
  case "run": {
    const { runDaemon } = await import("./daemon.ts");
    process.exit(await runDaemon());
    break;
  }
  case "install":
  case "uninstall":
  case "status":
  case "help":
  case "--help": {
    const { runCli } = await import("./cli.ts");
    const { serviceControlFor } = await import("./service-control.ts");
    process.exit(await runCli(process.argv.slice(2), serviceControlFor(resolveDaemonPaths())));
    break;
  }
  default:
    console.error(
      `Unknown command: ${command}\nUsage: pp-agentd [run|install|uninstall|status|help]`,
    );
    process.exit(2);
}
