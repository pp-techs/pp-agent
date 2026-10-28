import {
  type ChannelsSettings,
  DEFAULT_WORKSPACE_ID,
  type TelegramSettings,
  type TelegramChatSettings,
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

/** Invalid allowlists must never turn a restricted chat into an unrestricted members chat. */
function readChatSettings(value: Record<string, unknown>): TelegramChatSettings {
  const chat: TelegramChatSettings = {};
  if (typeof value.label === "string") chat.label = value.label;
  if (typeof value.agentId === "string" && value.agentId.trim()) chat.agentId = value.agentId;
  if (typeof value.workspaceId === "string" && value.workspaceId.trim())
    chat.workspaceId = value.workspaceId;
  if (value.access === "owner" || value.access === "members") chat.access = value.access;
  if (value.busyMode === "queue" || value.busyMode === "steer" || value.busyMode === "interrupt")
    chat.busyMode = value.busyMode;
  if (value.allowedUsers !== undefined) {
    if (Array.isArray(value.allowedUsers)) {
      chat.allowedUsers = value.allowedUsers.filter(
        (id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0,
      );
      if (value.allowedUsers.length > 0 && chat.allowedUsers.length === 0) chat.access = "owner";
    } else {
      chat.access = "owner";
    }
  }
  return chat;
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
  if (typeof value.chats === "object" && value.chats !== null && !Array.isArray(value.chats)) {
    telegram.chats = {};
    for (const [id, chat] of Object.entries(value.chats)) {
      if (!/^-?[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) continue;
      if (typeof chat !== "object" || chat === null || Array.isArray(chat)) continue;
      telegram.chats[id] = readChatSettings(chat as Record<string, unknown>);
    }
  }
  return { telegram };
}
