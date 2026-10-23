import type { DesktopBridge, UpdateState } from "@workspace/shared";
import { toast } from "sonner";

import { i18n } from "@/lib/i18n";

/** Runs an update command and shows a failure as a message. */
export function runUpdateCommand(command: Promise<void>): void {
  command.catch((error: Error) => toast.error(error.message));
}

/** One line telling the person where the update stands. */
export function describeUpdate(update: UpdateState): string {
  switch (update.status) {
    case "disabled":
      return i18n.t("modals:update.status.disabled");
    case "idle":
      return i18n.t("modals:update.status.idle", { current: update.currentVersion });
    case "checking":
      return i18n.t("modals:update.status.checking");
    case "up-to-date":
      return i18n.t("modals:update.status.upToDate", { current: update.currentVersion });
    case "available":
      return i18n.t("modals:update.status.available", {
        version: update.version,
        current: update.currentVersion,
      });
    case "downloading":
      return i18n.t("modals:update.status.downloading", {
        version: update.version,
        percent: update.percent,
      });
    case "ready":
      return i18n.t("modals:update.status.ready", { version: update.version });
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
      return {
        label: i18n.t("modals:update.actions.check"),
        run: () => runUpdateCommand(bridge.updates.check()),
      };
    case "available":
      return {
        label:
          update.install === "in-app"
            ? i18n.t("modals:update.actions.download")
            : i18n.t("modals:update.actions.getNewVersion"),
        run: () => runUpdateCommand(bridge.updates.download()),
      };
    case "ready":
      return {
        label: i18n.t("modals:update.actions.restart"),
        run: () => runUpdateCommand(bridge.updates.install()),
      };
    default:
      return null;
  }
}
