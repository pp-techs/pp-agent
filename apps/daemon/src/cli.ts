import type { ServiceControl } from "@workspace/agent-core";

const USAGE = `Usage: pp-agentd <command>

Commands:
  run        Run the daemon in the foreground
  install    Start the daemon at login and keep it running in the background
  uninstall  Stop starting the daemon at login and remove the background service
  status     Show whether the background service is installed
  help       Show this message
`;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Handles the service-management commands. `run` is not handled here; the daemon entry starts the
 * host for it. Returns the process exit code.
 */
export async function runCli(argv: string[], service: ServiceControl): Promise<number> {
  const [command] = argv;
  switch (command) {
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(USAGE);
      return 0;
    case "install":
      try {
        await service.install();
        const status = await service.status();
        process.stdout.write("The PP Agent service is installed and started.\n");
        if (status.detail) process.stdout.write(`${status.detail}\n`);
        return 0;
      } catch (error) {
        process.stderr.write(`Could not install the service: ${errorMessage(error)}\n`);
        return 1;
      }
    case "uninstall":
      try {
        await service.uninstall();
        process.stdout.write("The PP Agent service is removed.\n");
        return 0;
      } catch (error) {
        process.stderr.write(`Could not remove the service: ${errorMessage(error)}\n`);
        return 1;
      }
    case "status": {
      const status = await service.status();
      const lines = [
        `Supported: ${status.supported ? "yes" : "no"}`,
        `Service manager: ${status.manager ?? "none"}`,
        `Installed: ${status.installed ? "yes" : "no"}`,
      ];
      if (status.detail) lines.push(status.detail);
      process.stdout.write(`${lines.join("\n")}\n`);
      return status.installed ? 0 : 1;
    }
    default:
      process.stderr.write(command ? `Unknown command "${command}".\n\n${USAGE}` : USAGE);
      return 2;
  }
}
