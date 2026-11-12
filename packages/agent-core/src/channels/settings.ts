import type { ChannelsSettings } from "@workspace/shared";
import { readAccounts } from "./shared/accounts.ts";
import { readTelegramSettings } from "./telegram/settings.ts";
import { readZaloSettings } from "./zalo/settings.ts";

/** Reads `channels` from settings.json, one channel at a time, so a bad value stays in its channel. */
export function readChannelsSettings(raw: unknown): ChannelsSettings {
  const section = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    telegram: readAccounts(section.telegram, readTelegramSettings),
    zalo: readAccounts(section.zalo, readZaloSettings),
  };
}
