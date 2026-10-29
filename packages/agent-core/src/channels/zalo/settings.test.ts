import { describe, expect, test } from "vite-plus/test";
import { readChannelsSettings } from "../settings.ts";
import { defaultZaloSettings, readZaloSettings } from "./settings.ts";

describe("saved Zalo settings", () => {
  test("defaults to off and unpaired", () => {
    expect(readChannelsSettings(null).zalo).toEqual(defaultZaloSettings());
    expect(defaultZaloSettings()).toMatchObject({ enabled: false, ownerId: null, agentId: null });
  });

  test("restores valid fields through the channels reader", () => {
    const saved = {
      enabled: true,
      agentId: "agent-x",
      workspaceId: "ws-y",
      ownerId: "6ede9afa66b88fe6d6a9",
      ownerName: "Ann",
    };
    expect(readChannelsSettings({ zalo: saved }).zalo).toEqual(saved);
  });

  test("keeps good fields and drops bad ones", () => {
    const read = readZaloSettings({
      enabled: "yes",
      agentId: 5,
      workspaceId: " ",
      ownerId: 123,
      ownerName: "Ann",
    });
    expect(read).toEqual(defaultZaloSettings());
    expect(readZaloSettings({ ownerId: "u1", ownerName: "Ann" })).toMatchObject({
      ownerId: "u1",
      ownerName: "Ann",
    });
    expect(readZaloSettings("nope")).toEqual(defaultZaloSettings());
  });
});
