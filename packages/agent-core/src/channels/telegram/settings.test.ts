import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TelegramChatSettings } from "@workspace/shared";
import { describe, expect, test } from "vite-plus/test";
import { SettingsStore } from "../../settings-store.ts";
import { readChannelsSettings } from "../settings.ts";
import { defaultTelegramSettings } from "./settings.ts";

describe("saved Telegram chat settings", () => {
  test("restores labels, bindings, access, allowlists and busy modes through SettingsStore", () => {
    const directory = mkdtempSync(join(tmpdir(), "telegram-settings-"));
    try {
      const path = join(directory, "settings.json");
      const settings = new SettingsStore(path);
      const chats: Record<string, TelegramChatSettings> = {
        "7": {
          label: "Personal",
          agentId: "agent-x",
          workspaceId: "workspace-y",
          access: "owner",
          busyMode: "steer",
        },
        "-100123": {
          label: "Team",
          access: "members",
          allowedUsers: [7, 8],
          busyMode: "interrupt",
        },
        "-100456": { access: "members", allowedUsers: [], busyMode: "queue" },
      };
      settings.update((draft) => {
        draft.channels.telegram = [
          { id: "default", label: "", ...defaultTelegramSettings(), chats },
        ];
      });
      expect(new SettingsStore(path).get().channels.telegram[0]?.chats).toEqual(chats);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("keeps valid fields and ignores malformed chat entries and ids", () => {
    const result = readChannelsSettings({
      telegram: {
        enabled: true,
        chats: {
          "7": {
            label: "Valid",
            agentId: 1,
            workspaceId: " ",
            access: "public",
            busyMode: "invalid",
            extra: true,
          },
          "8": null,
          "9": [],
          invalid: { access: "members" },
          "9007199254740992": { access: "members" },
          "0": { access: "members" },
        },
      },
    });
    expect(result.telegram[0]?.enabled).toBe(true);
    expect(result.telegram[0]?.chats).toEqual({ "7": { label: "Valid" } });
    expect(readChannelsSettings({ telegram: { chats: [] } }).telegram[0]?.chats).toBeUndefined();
  });

  test.each(
    [null, "7", {}, ["7"], [0, -1, 1.5, 9007199254740992]].map((allowedUsers) => ({
      allowedUsers,
    })),
  )("fails closed for a malformed restricted allowlist: $allowedUsers", ({ allowedUsers }) => {
    const chat = readChannelsSettings({
      telegram: { chats: { "-100123": { access: "members", allowedUsers, busyMode: "steer" } } },
    }).telegram[0]?.chats?.["-100123"];
    expect(chat?.access).toBe("owner");
    expect(chat?.busyMode).toBe("steer");
  });

  test("removing invalid allowlist entries does not widen a valid restriction", () => {
    const chat = readChannelsSettings({
      telegram: { chats: { "-100123": { access: "members", allowedUsers: [7, "8", -1] } } },
    }).telegram[0]?.chats?.["-100123"];
    expect(chat).toEqual({ access: "members", allowedUsers: [7] });
  });
});
