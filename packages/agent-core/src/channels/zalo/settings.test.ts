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

  test("keeps valid chat fields and ignores malformed chat entries and ids", () => {
    const result = readChannelsSettings({
      zalo: {
        enabled: true,
        chats: {
          "zgr-1": {
            label: "Valid",
            agentId: 1,
            workspaceId: " ",
            access: "public",
            busyMode: "invalid",
            extra: true,
          },
          "zgr-2": null,
          "zgr-3": [],
          "": { access: "members" },
          "  ": { access: "members" },
        },
      },
    });
    expect(result.zalo.enabled).toBe(true);
    expect(result.zalo.chats).toEqual({ "zgr-1": { label: "Valid" } });
    expect(readChannelsSettings({ zalo: { chats: [] } }).zalo.chats).toBeUndefined();
  });

  test.each([null, "u1", {}, [""], [0, 1, "  "]].map((allowedUsers) => ({ allowedUsers })))(
    "fails closed for a malformed restricted allowlist: $allowedUsers",
    ({ allowedUsers }) => {
      const chat = readChannelsSettings({
        zalo: { chats: { "zgr-1": { access: "members", allowedUsers, busyMode: "steer" } } },
      }).zalo.chats?.["zgr-1"];
      expect(chat?.access).toBe("owner");
      expect(chat?.busyMode).toBe("steer");
    },
  );

  test("removing invalid allowlist entries does not widen a valid restriction", () => {
    const chat = readChannelsSettings({
      zalo: { chats: { "zgr-1": { access: "members", allowedUsers: ["u7", "", "u8"] } } },
    }).zalo.chats?.["zgr-1"];
    expect(chat).toEqual({ access: "members", allowedUsers: ["u7", "u8"] });
  });
});
