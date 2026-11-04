import type { ZaloChatSettings } from "@workspace/shared";

export interface ZaloChatDraft {
  chatId: string;
  label: string;
  access: "owner" | "members";
  busyMode: "queue" | "steer" | "interrupt";
  allowedUsers: string;
}

/** Zalo ids are opaque strings (for example `zgr-88c9f66a0b05e25bbb14`), never numeric. */
export function zaloChatId(value: string): string | null {
  const trimmed = value.trim();
  return /^\S+$/.test(trimmed) ? trimmed : null;
}

/** Never silently discard a malformed allowlist entry: that could broaden access. */
export function zaloAllowedUsers(value: string): string[] | null {
  if (!value.trim()) return [];
  const entries = value.split(",").map((entry) => entry.trim());
  if (entries.some((entry) => !/^\S+$/.test(entry))) return null;
  return [...new Set(entries)];
}

export function zaloChatSettings(
  existing: ZaloChatSettings | undefined,
  draft: ZaloChatDraft,
  allowedUsers: string[],
): ZaloChatSettings {
  return {
    ...existing,
    label: draft.label.trim(),
    access: draft.access,
    busyMode: draft.busyMode,
    allowedUsers,
  };
}
