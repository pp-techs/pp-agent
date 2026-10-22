import type { DesktopBridge, UpdateState } from "@workspace/shared";
import { toast } from "sonner";

/** Runs an update command and shows a failure as a message. */
export function runUpdateCommand(command: Promise<void>): void {
  command.catch((error: Error) => toast.error(error.message));
}

/** One line telling the person where the update stands. */
export function describeUpdate(update: UpdateState): string {
  switch (update.status) {
    case "disabled":
      return "Updates are only checked in the installed app.";
    case "idle":
      return `Version ${update.currentVersion}`;
    case "checking":
      return "Checking for updates…";
    case "up-to-date":
      return `Version ${update.currentVersion}. You have the latest version.`;
    case "available":
      return `Version ${update.version} is available. You have ${update.currentVersion}.`;
    case "downloading":
      return `Downloading version ${update.version}… ${update.percent}%`;
    case "ready":
      return `Version ${update.version} is ready. Restart the app to finish updating.`;
    case "error":
      return update.message;
  }
}

/** What the main button does in each state; null when there is nothing to do. */
export function updateAction(
  bridge: DesktopBridge,
  update: UpdateState,
): { label: string; run: () => void } | null {
  switch (update.status) {
    case "idle":
    case "up-to-date":
    case "error":
      return { label: "Check for updates", run: () => runUpdateCommand(bridge.updates.check()) };
    case "available":
      return {
        label: update.install === "in-app" ? "Download update" : "Get the new version",
        run: () => runUpdateCommand(bridge.updates.download()),
      };
    case "ready":
      return { label: "Restart to update", run: () => runUpdateCommand(bridge.updates.install()) };
    default:
      return null;
  }
}
