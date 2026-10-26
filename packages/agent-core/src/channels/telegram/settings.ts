import {
  type ChannelsSettings,
  DEFAULT_WORKSPACE_ID,
  type TelegramSettings,
} from "@workspace/shared";

export function defaultTelegramSettings(): TelegramSettings {
  return {
    enabled: false,
    agentId: null,
    workspaceId: DEFAULT_WORKSPACE_ID,
    ownerId: null,
    ownerName: null,
  };
}

/** Reads `channels` from settings.json field by field, so one bad value keeps the others. */
export function readChannelsSettings(raw: unknown): ChannelsSettings {
  const telegram = defaultTelegramSettings();
  const section = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const value =
    typeof section.telegram === "object" && section.telegram !== null
      ? (section.telegram as Record<string, unknown>)
      : {};
  telegram.enabled = value.enabled === true;
  if (typeof value.agentId === "string" && value.agentId.trim()) telegram.agentId = value.agentId;
  if (typeof value.workspaceId === "string" && value.workspaceId.trim())
    telegram.workspaceId = value.workspaceId;
  if (typeof value.ownerId === "number" && Number.isSafeInteger(value.ownerId))
    telegram.ownerId = value.ownerId;
  if (typeof value.ownerName === "string" && telegram.ownerId !== null)
    telegram.ownerName = value.ownerName;
  return { telegram };
}
