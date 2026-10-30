/**
 * Apps the agent's `computer` tool may use. Stored in settings.json (`SettingsFile.computerApps`):
 * apps the person allowed for every conversation and apps they blocked. An app on neither list is
 * asked about the first time a conversation uses it; protected apps are refused whatever the lists
 * say (`isProtectedComputerApp`).
 */
import {
  COMPUTER_APP_LIMITS,
  type ComputerApp,
  type ComputerAppAccess,
  type ComputerAppRemember,
  isProtectedComputerApp,
} from "@workspace/shared";
import { t } from "./i18n.ts";

function readApp(value: unknown): ComputerApp | null {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as Partial<Record<keyof ComputerApp, unknown>>;
  if (typeof entry.id !== "string" || typeof entry.name !== "string") return null;
  return checkApp({ id: entry.id, name: entry.name });
}

/** Trimmed and within the limits; null when the id is empty or too long. */
export function checkApp(app: ComputerApp): ComputerApp | null {
  const id = app.id.trim();
  if (!id || id.length > COMPUTER_APP_LIMITS.maxIdLength) return null;
  const name = app.name.trim().slice(0, COMPUTER_APP_LIMITS.maxNameLength) || id;
  return { id, name };
}

function readList(raw: unknown): ComputerApp[] {
  if (!Array.isArray(raw)) return [];
  const apps: ComputerApp[] = [];
  for (const value of raw) {
    const app = readApp(value);
    if (!app || apps.some((entry) => entry.id === app.id)) continue;
    apps.push(app);
    if (apps.length >= COMPUTER_APP_LIMITS.maxApps) break;
  }
  return apps;
}

/** The lists read from settings.json; an app on both is kept as blocked only. */
export function readComputerApps(raw: unknown): ComputerAppAccess {
  const value =
    typeof raw === "object" && raw !== null ? (raw as Partial<ComputerAppAccess>) : null;
  const blocked = readList(value?.blocked);
  const allowed = readList(value?.allowed).filter(
    (app) => !blocked.some((entry) => entry.id === app.id),
  );
  return { allowed, blocked };
}

/** Puts `app` on one list (or neither), keeping the newest choice last; the oldest fall off. */
export function withAccess(
  current: ComputerAppAccess,
  app: ComputerApp,
  access: "allowed" | "blocked" | null,
): ComputerAppAccess {
  const others = (list: ComputerApp[]) => list.filter((entry) => entry.id !== app.id);
  const add = (list: ComputerApp[]) => [...others(list), app].slice(-COMPUTER_APP_LIMITS.maxApps);
  if (access === "allowed" && isProtectedComputerApp(app))
    throw new Error(t("computerApps.protected", { name: app.name }));
  return {
    allowed: access === "allowed" ? add(current.allowed) : others(current.allowed),
    blocked: access === "blocked" ? add(current.blocked) : others(current.blocked),
  };
}

/**
 * Keeps an app the person approved: for the conversation, or always (`saveAlways`, which writes
 * settings.json). A save that fails keeps it for the conversation instead and returns the error, so
 * the approval itself still goes through.
 */
export function rememberApproval(
  app: ComputerApp,
  remember: ComputerAppRemember | undefined,
  conversation: Set<string>,
  saveAlways: (app: ComputerApp) => void,
): Error | null {
  if (remember === "conversation") conversation.add(app.id);
  if (remember !== "always") return null;
  try {
    saveAlways(app);
    return null;
  } catch (error) {
    conversation.add(app.id);
    return error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Whether a `computer` call may use its app: apps that are protected or blocked are refused, apps
 * allowed always or for the conversation go on to the tool's rule, any other app is asked about.
 * A call without an app (`apps`, or one the tool itself refuses) needs no app approval.
 */
export function computerAppAccess(
  value: unknown,
  lists: ComputerAppAccess,
  conversation: ReadonlySet<string>,
  nameOf: (id: string) => string | undefined,
): { kind: "refused"; reason: string } | { kind: "allowed" } | { kind: "ask"; app: ComputerApp } {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id) return { kind: "allowed" };
  const app = checkApp({ id, name: nameOf(id) ?? id });
  if (!app) return { kind: "refused", reason: "This app id is not valid." };
  if (isProtectedComputerApp(app))
    return { kind: "refused", reason: t("computerApps.protected", { name: app.name }) };
  if (lists.blocked.some((entry) => entry.id === id))
    return { kind: "refused", reason: t("computerApps.blocked", { name: app.name }) };
  if (conversation.has(id) || lists.allowed.some((entry) => entry.id === id))
    return { kind: "allowed" };
  return { kind: "ask", app };
}
