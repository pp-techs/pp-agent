import type { TelegramChatSettings } from "@workspace/shared";

export interface TelegramChatDraft {
  chatId: string;
  label: string;
  access: "owner" | "members";
  busyMode: "queue" | "steer" | "interrupt";
  allowedUsers: string;
}

/** Chat ids may be negative for groups; all ids must be exactly representable. */
export function telegramChatId(value: string): string | null {
  const trimmed = value.trim();
  const id = Number(trimmed);
  return /^-?[1-9]\d*$/.test(trimmed) && Number.isSafeInteger(id) ? String(id) : null;
}

/** Never silently discard a malformed allowlist entry: that could broaden access. */
export function telegramAllowedUsers(value: string): number[] | null {
  if (!value.trim()) return [];
  const entries = value.split(",").map((entry) => entry.trim());
  if (entries.some((entry) => !/^[1-9]\d*$/.test(entry) || !Number.isSafeInteger(Number(entry)))) {
    return null;
  }
  return [...new Set(entries.map(Number))];
}

export function telegramChatSettings(
  existing: TelegramChatSettings | undefined,
  draft: TelegramChatDraft,
  allowedUsers: number[],
): TelegramChatSettings {
  return {
    ...existing,
    label: draft.label.trim(),
    access: draft.access,
    busyMode: draft.busyMode,
    allowedUsers,
  };
}
