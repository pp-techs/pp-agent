import type { TelegramStatus, ZaloStatus } from "@workspace/shared";
import { describe, expect, test } from "vite-plus/test";

import { chatChoices, deliveryOf, deliveryValue } from "./scheduled-task-delivery";

const telegram = (extra: Partial<TelegramStatus> = {}): TelegramStatus => ({
  id: "default",
  label: "",
  enabled: true,
  hasToken: true,
  workspaceId: "default",
  agentId: null,
  ownerId: 111,
  ownerName: "Ann",
  botUsername: "bot",
  state: "online",
  error: null,
  pairingCode: null,
  pairingExpiresAt: null,
  ...extra,
});

const app = (kind: "telegram" | "zalo") => (kind === "telegram" ? "Telegram" : "Zalo");

describe("delivery values", () => {
  test("round trip, and a missing delivery is the default", () => {
    expect(deliveryValue(undefined)).toBe("session");
    expect(deliveryValue({ to: "session" })).toBe("session");
    expect(deliveryValue({ to: "none" })).toBe("none");
    expect(deliveryValue({ to: "peer", peer: "telegram:111" })).toBe("peer:telegram:111");
    expect(deliveryOf("session")).toEqual({ to: "session" });
    expect(deliveryOf("none")).toEqual({ to: "none" });
    expect(deliveryOf("peer:telegram:work:-100")).toEqual({
      to: "peer",
      peer: "telegram:work:-100",
    });
  });
});

describe("chatChoices", () => {
  test("lists the paired owner's chat with the keys the agent uses", () => {
    expect(chatChoices([telegram()], [], app)).toEqual([
      { value: "peer:telegram:111", label: "Telegram – Ann" },
    ]);
  });

  test("a later account keeps its id in the key and its name in the label", () => {
    const choices = chatChoices(
      [telegram(), telegram({ id: "work", label: "Work", ownerId: 5 })],
      [],
      app,
    );
    expect(choices[1]).toEqual({ value: "peer:telegram:work:5", label: "Telegram (Work) – Ann" });
  });

  test("adds the chats of an account after its owner, using the label or the id", () => {
    const choices = chatChoices(
      [telegram({ chats: { "-100": { label: "Team" }, "-200": {}, "111": { label: "dup" } } })],
      [],
      app,
    );
    expect(choices.map((c) => [c.value, c.label])).toEqual([
      ["peer:telegram:111", "Telegram – Ann"],
      ["peer:telegram:-100", "Telegram – Team"],
      ["peer:telegram:-200", "Telegram – -200"],
    ]);
  });

  test("skips accounts that are off, without a token, or without a paired owner", () => {
    expect(chatChoices([telegram({ enabled: false })], [], app)).toEqual([]);
    expect(chatChoices([telegram({ hasToken: false })], [], app)).toEqual([]);
    expect(chatChoices([telegram({ ownerId: null })], [], app)).toEqual([]);
    expect(chatChoices(undefined, undefined, app)).toEqual([]);
  });

  test("includes Zalo, whose ids are text", () => {
    const zalo = {
      id: "default",
      label: "",
      enabled: true,
      hasToken: true,
      workspaceId: "default",
      agentId: null,
      ownerId: "abc",
      ownerName: null,
      botName: null,
      state: "online",
      error: null,
      pairingCode: null,
      pairingExpiresAt: null,
    } satisfies ZaloStatus;
    expect(chatChoices([], [zalo], app)).toEqual([{ value: "peer:zalo:abc", label: "Zalo – abc" }]);
  });
});
