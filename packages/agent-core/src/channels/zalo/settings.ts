import { DEFAULT_WORKSPACE_ID, type ZaloChatSettings, type ZaloSettings } from "@workspace/shared";

export function defaultZaloSettings(): ZaloSettings {
  return {
    enabled: false,
    agentId: null,
    workspaceId: DEFAULT_WORKSPACE_ID,
    ownerId: null,
    ownerName: null,
  };
}

/** Invalid allowlists must never turn a restricted chat into an unrestricted members chat. */
function readChatSettings(value: Record<string, unknown>): ZaloChatSettings {
  const chat: ZaloChatSettings = {};
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
        (id): id is string => typeof id === "string" && id.trim() !== "",
      );
      if (value.allowedUsers.length > 0 && chat.allowedUsers.length === 0) chat.access = "owner";
    } else {
      chat.access = "owner";
    }
  }
  return chat;
}

/** Reads `channels.zalo` from settings.json field by field, so one bad value keeps the others. */
export function readZaloSettings(raw: unknown): ZaloSettings {
  const zalo = defaultZaloSettings();
  if (typeof raw !== "object" || raw === null) return zalo;
  const value = raw as Record<string, unknown>;
  zalo.enabled = value.enabled === true;
  if (typeof value.agentId === "string" && value.agentId.trim()) zalo.agentId = value.agentId;
  if (typeof value.workspaceId === "string" && value.workspaceId.trim())
    zalo.workspaceId = value.workspaceId;
  if (typeof value.ownerId === "string" && value.ownerId.trim()) zalo.ownerId = value.ownerId;
  if (typeof value.ownerName === "string" && zalo.ownerId !== null)
    zalo.ownerName = value.ownerName;
  if (typeof value.chats === "object" && value.chats !== null && !Array.isArray(value.chats)) {
    zalo.chats = {};
    for (const [id, chat] of Object.entries(value.chats)) {
      if (!id.trim()) continue;
      if (typeof chat !== "object" || chat === null || Array.isArray(chat)) continue;
      zalo.chats[id] = readChatSettings(chat as Record<string, unknown>);
    }
  }
  return zalo;
}
