import type { BrowserWindow } from "electron";
import { Notification } from "electron";
import type { AgentEvent, ChatMessage } from "@workspace/shared";
import { translator } from "./i18n.ts";

const MAX_TITLE_LENGTH = 80;

export interface Notifier {
  /** Feeds every agent event; notifies when a run finishes or an approval is needed. */
  handle(event: AgentEvent): void;
  /** Session file of the conversation that is open now, or null. */
  currentSession(): string | null;
}

function firstText(message: ChatMessage): string | null {
  for (const part of message.parts) {
    if (part.type === "text" && part.text.trim()) return part.text.trim();
  }
  return null;
}

function shorten(text: string): string {
  const line = text.replace(/\s+/g, " ");
  return line.length > MAX_TITLE_LENGTH ? `${line.slice(0, MAX_TITLE_LENGTH - 1)}…` : line;
}

/**
 * Native notifications for a run that finished and for an approval that waits, while the window is
 * hidden, minimized, or not in front. The main process owns `Notification`; the agent's events
 * (which already pass through main) drive it.
 *
 * `activate` runs when the notification is clicked, with the conversation it was about; it brings
 * the window forward and opens that conversation when another one is open by then.
 */
export function createNotifier(options: {
  window: () => BrowserWindow | null;
  enabled: () => boolean;
  activate: (sessionPath: string | null) => void;
}): Notifier {
  let status: string = "starting";
  let sessionPath: string | null = null;
  let title: string | null = null;
  // Notifications are garbage-collected (and then never fire `click`) unless something holds them.
  const alive = new Set<Notification>();

  function windowInFront(): boolean {
    const window = options.window();
    return !!window && window.isVisible() && !window.isMinimized() && window.isFocused();
  }

  function show(heading: string, body: string): void {
    if (!options.enabled() || !Notification.isSupported() || windowInFront()) return;
    const notification = new Notification({ title: heading, body });
    const path = sessionPath;
    alive.add(notification);
    notification.on("click", () => options.activate(path));
    notification.on("close", () => alive.delete(notification));
    notification.show();
  }

  return {
    currentSession: () => sessionPath,
    handle(event) {
      const t = translator();
      switch (event.type) {
        case "snapshot":
          sessionPath = event.snapshot.sessionPath;
          status = event.snapshot.status;
          title = null;
          for (const message of event.snapshot.messages) {
            if (message.role !== "user") continue;
            const text = firstText(message);
            if (text) {
              title = shorten(text);
              break;
            }
          }
          return;
        case "message":
          if (title === null && event.message.role === "user") {
            const text = firstText(event.message);
            if (text) title = shorten(text);
          }
          return;
        case "status": {
          const finished = status === "running" && event.status === "idle";
          status = event.status;
          if (finished)
            show(
              t("shell.notification.runFinished"),
              t("shell.notification.runFinishedBody", { title: title ?? "PP Agent" }),
            );
          return;
        }
        case "approval_requested":
          show(
            t("shell.notification.approvalNeeded"),
            t("shell.notification.approvalNeededBody", {
              title: title ?? "PP Agent",
              tool: event.request.title,
            }),
          );
          return;
        case "question_requested":
          show(
            t("shell.notification.questionAsked"),
            t("shell.notification.questionAskedBody", { title: title ?? "PP Agent" }),
          );
      }
    },
  };
}
