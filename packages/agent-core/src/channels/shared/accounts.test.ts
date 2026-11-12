import { describe, expect, test } from "vite-plus/test";
import { readChannelsSettings } from "../settings.ts";
import {
  accountDisplayName,
  accountTokenKey,
  chatKeyPrefix,
  findChannel,
  newAccountId,
  offsetFileName,
} from "./accounts.ts";

describe("names of an account's things", () => {
  test("the first account keeps the names used before accounts existed", () => {
    expect(chatKeyPrefix("telegram", "default")).toBe("telegram");
    expect(accountTokenKey("telegram", "default")).toBe("channel:telegram");
    expect(accountTokenKey("zalo", "default")).toBe("channel:zalo");
    expect(offsetFileName("telegram", "default")).toBe("telegram-offset.json");
  });

  test("another account has its own chat keys, token and offset file", () => {
    expect(chatKeyPrefix("telegram", "work")).toBe("telegram:work");
    expect(accountTokenKey("telegram", "work")).toBe("channel:telegram:work");
    expect(offsetFileName("telegram", "work")).toBe("telegram-offset-work.json");
  });

  test("a label is shown after the app's name", () => {
    expect(accountDisplayName("Telegram", "")).toBe("Telegram");
    expect(accountDisplayName("Telegram", "Work")).toBe("Telegram (Work)");
  });
});

describe("newAccountId", () => {
  test("the first account is `default`", () => {
    expect(newAccountId([], "Work")).toBe("default");
  });

  test("later accounts take a slug of their name, made unique", () => {
    expect(newAccountId(["default"], "Work Bot")).toBe("work-bot");
    expect(newAccountId(["default", "work-bot"], "Work Bot")).toBe("work-bot-2");
    expect(newAccountId(["default"], "Công việc")).toBe("cong-viec");
  });

  test("an empty or unusable name becomes `bot`, and never `default`", () => {
    expect(newAccountId(["default"], "")).toBe("bot");
    expect(newAccountId(["default"], "!!!")).toBe("bot");
    expect(newAccountId(["default"], "Default")).toBe("bot");
  });

  test("an id never contains the `:` of a chat key", () => {
    expect(newAccountId(["default"], "a:b")).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
  });
});

describe("reading saved accounts", () => {
  test("nothing saved means no accounts", () => {
    expect(readChannelsSettings(null)).toEqual({ telegram: [], zalo: [] });
  });

  test("the single object written before accounts becomes the account `default`", () => {
    const { telegram } = readChannelsSettings({
      telegram: { enabled: true, ownerId: 7, ownerName: "Ann", workspaceId: "ws" },
    });
    expect(telegram).toHaveLength(1);
    expect(telegram[0]).toMatchObject({
      id: "default",
      label: "",
      enabled: true,
      ownerId: 7,
      ownerName: "Ann",
      workspaceId: "ws",
    });
  });

  test("a list keeps each account's own settings", () => {
    const { telegram } = readChannelsSettings({
      telegram: [
        { id: "default", enabled: true, ownerId: 1 },
        {
          id: "work",
          label: " Work ",
          enabled: false,
          ownerId: 2,
          chats: { "-5": { label: "T" } },
        },
      ],
    });
    expect(telegram.map((a) => [a.id, a.label, a.enabled, a.ownerId])).toEqual([
      ["default", "", true, 1],
      ["work", "Work", false, 2],
    ]);
    expect(telegram[1]?.chats).toEqual({ "-5": { label: "T" } });
  });

  test("drops accounts with a bad or repeated id, keeping the first of a repeat", () => {
    const { zalo } = readChannelsSettings({
      zalo: [
        { id: "a:b" },
        { id: "" },
        { id: "Upper" },
        { enabled: true },
        "nope",
        null,
        { id: "ok", ownerId: "first" },
        { id: "ok", ownerId: "second" },
      ],
    });
    expect(zalo.map((a) => [a.id, a.ownerId])).toEqual([["ok", "first"]]);
  });

  test("a bad account does not take the other app's accounts with it", () => {
    const { telegram, zalo } = readChannelsSettings({
      telegram: "broken",
      zalo: [{ id: "default", enabled: true }],
    });
    expect(telegram).toEqual([]);
    expect(zalo).toHaveLength(1);
  });
});

describe("findChannel", () => {
  const channels = [
    { id: "telegram" },
    { id: "telegram:work" },
    { id: "zalo" },
    { id: "zalo:shop" },
  ];

  test("the first account owns `telegram:<chat>`, another `telegram:<account>:<chat>`", () => {
    expect(findChannel(channels, "telegram:123")?.id).toBe("telegram");
    expect(findChannel(channels, "telegram:-100456")?.id).toBe("telegram");
    expect(findChannel(channels, "telegram:work:123")?.id).toBe("telegram:work");
    expect(findChannel(channels, "zalo:abc")?.id).toBe("zalo");
    expect(findChannel(channels, "zalo:shop:abc")?.id).toBe("zalo:shop");
  });

  test("a chat id that spells another account's id still belongs to the first account", () => {
    // `telegram:work` is a chat id here, not an account: the first account has no such chat id in
    // practice (ids are numbers), but the key must not be taken for the second account's own id.
    expect(findChannel(channels, "telegram:work")?.id).toBe("telegram");
  });

  test("a removed account's keys, and other apps, match nothing", () => {
    expect(findChannel([{ id: "telegram" }], "telegram:gone:123")).toBeUndefined();
    expect(findChannel(channels, "slack:1")).toBeUndefined();
    expect(findChannel(channels, "telegram")).toBeUndefined();
    expect(findChannel(channels, "telegram:")?.id).toBe("telegram");
  });
});
