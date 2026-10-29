import { DEFAULT_WORKSPACE_ID, type ZaloSettings } from "@workspace/shared";

export function defaultZaloSettings(): ZaloSettings {
  return {
    enabled: false,
    agentId: null,
    workspaceId: DEFAULT_WORKSPACE_ID,
    ownerId: null,
    ownerName: null,
  };
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
  return zalo;
}
