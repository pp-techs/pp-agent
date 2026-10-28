import { describe, expect, test } from "vite-plus/test";

import {
  telegramAllowedUsers,
  telegramChatId,
  telegramChatSettings,
  type TelegramChatDraft,
} from "./telegram-chat-fields";

const draft: TelegramChatDraft = {
  chatId: "-1001234567890",
  label: "Team",
  access: "members",
  busyMode: "queue",
  allowedUsers: "42, 43",
};

describe("Telegram chat fields", () => {
  test("accept private and group ids for the first chat without discovery", () => {
    expect(telegramChatId(" 42 ")).toBe("42");
    expect(telegramChatId(draft.chatId)).toBe("-1001234567890");
    expect(telegramChatSettings(undefined, draft, [42, 43])).toEqual({
      label: "Team",
      access: "members",
      busyMode: "queue",
      allowedUsers: [42, 43],
    });
  });

  test("reject invalid, fractional, zero and unsafe chat ids", () => {
    for (const value of ["", "@team", "0", "42.5", "1e4", "9007199254740993"]) {
      expect(telegramChatId(value)).toBeNull();
    }
  });

  test("clears the label and allowlist while retaining unrelated chat settings", () => {
    const existing = {
      label: "Old label",
      allowedUsers: [42],
      agentId: "finance",
      workspaceId: "reports",
      access: "members" as const,
      busyMode: "steer" as const,
    };
    const cleared = { ...draft, label: "", allowedUsers: "", busyMode: "steer" as const };
    expect(telegramChatSettings(existing, cleared, telegramAllowedUsers("")!)).toEqual({
      ...existing,
      label: "",
      allowedUsers: [],
    });
  });

  test("accepts an empty allowlist and deduplicates valid user ids", () => {
    expect(telegramAllowedUsers("   ")).toEqual([]);
    expect(telegramAllowedUsers("42, 43, 42")).toEqual([42, 43]);
  });

  test("never drops invalid allowlist entries and accidentally permits everyone", () => {
    for (const value of ["abc", "42, invalid", "42,", "0", "-42", "1.5", "9007199254740993"]) {
      expect(telegramAllowedUsers(value)).toBeNull();
    }
  });
});
