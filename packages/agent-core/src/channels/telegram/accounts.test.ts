import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Credential } from "@earendil-works/pi-ai";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_WORKSPACE_ID,
  type SaveTelegramInput,
  type TelegramStatus,
} from "@workspace/shared";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { SettingsStore } from "../../settings-store.ts";
import { ChannelAccounts } from "../shared/accounts.ts";
import { FakeGateway } from "../shared/testing.ts";
import type { TelegramUpdate } from "./api.ts";
import { TelegramService } from "./service.ts";
import { FakeApi, fakeT, textUpdate } from "./testing.ts";

class FakeVault {
  entries = new Map<string, Credential>();
  async read(id: string) {
    return this.entries.get(id);
  }
  async modify(
    id: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ) {
    const next = await fn(this.entries.get(id));
    if (next) this.entries.set(id, next);
    return next;
  }
  async delete(id: string) {
    this.entries.delete(id);
  }
}

let directory: string;
const stops: Array<() => Promise<void>> = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "pp-telegram-accounts-"));
});

afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()));
  rmSync(directory, { recursive: true, force: true });
});

/** Two bots with their own fake Telegram, behind one manager like the host builds. */
function setup() {
  const settings = new SettingsStore(join(directory, "settings.json"));
  const vault = new FakeVault();
  const gateway = new FakeGateway();
  const apis = new Map<string, FakeApi>();
  const apiFor = (token: string) => {
    let api = apis.get(token);
    if (!api) {
      api = new FakeApi();
      api.me = { ...api.me, id: apis.size + 1, username: `bot_${apis.size + 1}` };
      apis.set(token, api);
    }
    return api;
  };
  const changed = vi.fn();
  const accounts = new ChannelAccounts<TelegramStatus, SaveTelegramInput>({
    saved: () => settings.get().channels.telegram,
    create: (accountId) => {
      const service = new TelegramService({
        accountId,
        dataDir: directory,
        settings,
        credentials: vault,
        gateway,
        changed,
        t: fakeT,
        api: apiFor,
      });
      stops.push(() => service.stop());
      return service;
    },
    tokenInUse: () => "token in use",
    unknownAccount: (id) => `unknown account ${id}`,
  });
  return { settings, vault, gateway, accounts, apiFor };
}

const base = {
  enabled: true,
  agentId: DEFAULT_AGENT_ID,
  workspaceId: DEFAULT_WORKSPACE_ID,
};

describe("adding accounts", () => {
  test("the first account is `default` with the token under the old vault id", async () => {
    const { accounts, vault, settings } = setup();
    const saved = await accounts.save({ ...base, token: "111:aaa", label: "Personal" });
    expect(saved).toMatchObject({ id: "default", label: "Personal", state: "online" });
    expect(vault.entries.get("channel:telegram")).toEqual({ type: "api_key", key: "111:aaa" });
    expect(settings.get().channels.telegram.map((a) => a.id)).toEqual(["default"]);
  });

  test("a second account gets its own id, token and bot", async () => {
    const { accounts, vault, settings } = setup();
    await accounts.save({ ...base, token: "111:aaa" });
    const second = await accounts.save({ ...base, token: "222:bbb", label: "Work Bot" });
    expect(second).toMatchObject({
      id: "work-bot",
      label: "Work Bot",
      botUsername: "bot_2",
      state: "online",
    });
    expect(vault.entries.get("channel:telegram:work-bot")).toEqual({
      type: "api_key",
      key: "222:bbb",
    });
    expect(vault.entries.get("channel:telegram")).toEqual({ type: "api_key", key: "111:aaa" });
    expect(settings.get().channels.telegram.map((a) => a.id)).toEqual(["default", "work-bot"]);
    const listed = await accounts.list();
    expect(listed.map((a) => [a.id, a.botUsername, a.state])).toEqual([
      ["default", "bot_1", "online"],
      ["work-bot", "bot_2", "online"],
    ]);
  });

  test("a new account needs a token, even when switched off", async () => {
    const { accounts, settings } = setup();
    await accounts.save({ ...base, token: "111:aaa" });
    await expect(accounts.save({ ...base, enabled: false, label: "Other" })).rejects.toThrow(
      "channels.telegram.tokenRequired",
    );
    expect(settings.get().channels.telegram.map((a) => a.id)).toEqual(["default"]);
    expect((await accounts.list()).map((a) => a.id)).toEqual(["default"]);
  });

  test("refuses a token another account already uses, adding or changing", async () => {
    const { accounts, vault } = setup();
    await accounts.save({ ...base, token: "111:aaa" });
    await expect(accounts.save({ ...base, token: "111:aaa", label: "Copy" })).rejects.toThrow(
      "token in use",
    );
    const second = await accounts.save({ ...base, token: "222:bbb", label: "Work" });
    await expect(
      accounts.save({ ...base, accountId: second.id, token: "111:aaa" }),
    ).rejects.toThrow("token in use");
    // Re-saving an account with its own token is not a clash.
    await accounts.save({ ...base, accountId: second.id, token: "222:bbb" });
    expect(vault.entries.size).toBe(2);
    expect((await accounts.list()).map((a) => a.id)).toEqual(["default", "work"]);
  });

  test("a token Telegram refuses leaves no account behind", async () => {
    const { accounts, vault, settings, apiFor } = setup();
    await accounts.save({ ...base, token: "111:aaa" });
    const { TelegramApiError } = await import("./api.ts");
    apiFor("333:ccc").getMeError = new TelegramApiError("unauthorized", "Unauthorized", 401);
    await expect(accounts.save({ ...base, token: "333:ccc", label: "Bad" })).rejects.toThrow(
      "channels.telegram.tokenInvalid",
    );
    expect(vault.entries.size).toBe(1);
    expect(settings.get().channels.telegram.map((a) => a.id)).toEqual(["default"]);
    expect((await accounts.list()).map((a) => a.id)).toEqual(["default"]);
  });

  test("changing one account leaves the other untouched", async () => {
    const { accounts, settings } = setup();
    await accounts.save({ ...base, token: "111:aaa" });
    const second = await accounts.save({ ...base, token: "222:bbb", label: "Work" });
    await accounts.save({
      ...base,
      accountId: second.id,
      enabled: false,
      chats: { "-100": { access: "members" } },
    });
    const [first, other] = settings.get().channels.telegram;
    expect(first).toMatchObject({ enabled: true, label: "" });
    expect(first?.chats).toBeUndefined();
    expect(other).toMatchObject({ enabled: false, label: "Work" });
    expect(other?.chats).toEqual({ "-100": { access: "members" } });
  });

  test("an unknown account is reported", async () => {
    const { accounts } = setup();
    await expect(accounts.save({ ...base, accountId: "nope" })).rejects.toThrow(
      "unknown account nope",
    );
    await expect(accounts.startPairing("nope")).rejects.toThrow("unknown account nope");
    await expect(accounts.forget("nope")).rejects.toThrow("unknown account nope");
  });
});

describe("two bots at once", () => {
  async function twoPaired() {
    const context = setup();
    await context.accounts.save({ ...base, token: "111:aaa" });
    await context.accounts.save({ ...base, token: "222:bbb", label: "Work" });
    for (const [id, token, user] of [
      ["default", "111:aaa", 41],
      ["work", "222:bbb", 42],
    ] as const) {
      const { pairingCode } = await context.accounts.startPairing(id);
      context.apiFor(token).push(textUpdate(1, `/pair ${pairingCode}`, user));
      await vi.waitFor(() =>
        expect(context.settings.get().channels.telegram.find((a) => a.id === id)?.ownerId).toBe(
          user,
        ),
      );
      context.apiFor(token).sent.length = 0;
    }
    return context;
  }

  test("each bot pairs its own owner", async () => {
    const { settings, accounts } = await twoPaired();
    expect(settings.get().channels.telegram.map((a) => [a.id, a.ownerId])).toEqual([
      ["default", 41],
      ["work", 42],
    ]);
    expect((await accounts.list()).map((a) => a.pairingCode)).toEqual([null, null]);
  });

  test("a code opened for one account does not pair through the other", async () => {
    const context = setup();
    await context.accounts.save({ ...base, token: "111:aaa" });
    await context.accounts.save({ ...base, token: "222:bbb", label: "Work" });
    const { pairingCode } = await context.accounts.startPairing("work");
    context.apiFor("111:aaa").push(textUpdate(1, `/pair ${pairingCode}`, 41));
    await vi.waitFor(() => expect(context.apiFor("111:aaa").offsets.at(-1)).toBe(2));
    expect(context.settings.get().channels.telegram.every((a) => a.ownerId === null)).toBe(true);
  });

  test("chats of the first bot use `telegram:<chat>`, the second `telegram:<account>:<chat>`", async () => {
    const { apiFor, gateway } = await twoPaired();
    apiFor("111:aaa").push(textUpdate(2, "hello one", 41));
    apiFor("222:bbb").push(textUpdate(2, "hello two", 42));
    await vi.waitFor(() => expect(gateway.turns).toHaveLength(2));
    expect(gateway.turns.map((turn) => turn.chatKey).sort()).toEqual([
      "telegram:41",
      "telegram:work:42",
    ]);
  });

  test("one person's chat id on both bots is two separate conversations", async () => {
    const context = setup();
    await context.accounts.save({ ...base, token: "111:aaa" });
    await context.accounts.save({ ...base, token: "222:bbb", label: "Work" });
    for (const [id, token] of [
      ["default", "111:aaa"],
      ["work", "222:bbb"],
    ] as const) {
      const { pairingCode } = await context.accounts.startPairing(id);
      context.apiFor(token).push(textUpdate(1, `/pair ${pairingCode}`, 7));
      await vi.waitFor(() =>
        expect(context.settings.get().channels.telegram.find((a) => a.id === id)?.ownerId).toBe(7),
      );
    }
    context.apiFor("111:aaa").push(textUpdate(2, "a", 7));
    context.apiFor("222:bbb").push(textUpdate(2, "b", 7));
    await vi.waitFor(() => expect(context.gateway.turns).toHaveLength(2));
    expect(new Set(context.gateway.turns.map((turn) => turn.chatKey))).toEqual(
      new Set(["telegram:7", "telegram:work:7"]),
    );
  });

  test("an account's chat settings apply to its bot only", async () => {
    const context = await twoPaired();
    await context.accounts.save({
      ...base,
      accountId: "work",
      chats: { "-100": { access: "members" } },
    });
    // The same group id on the first bot is not configured, so its messages are ignored.
    const inGroup = (id: number): TelegramUpdate => ({
      update_id: id,
      message: {
        message_id: id,
        chat: { id: -100, type: "group" },
        from: { id: 99, first_name: "Bob" },
        text: "hi",
      },
    });
    context.apiFor("111:aaa").push(inGroup(3));
    context.apiFor("222:bbb").push(inGroup(3));
    await vi.waitFor(() => expect(context.gateway.turns).toHaveLength(1));
    expect(context.gateway.turns[0]?.chatKey).toBe("telegram:work:-100");
  });

  test("each account delivers through its own bot", async () => {
    const { accounts, apiFor } = await twoPaired();
    const [first, second] = accounts.services();
    await second?.deliver("home", "from work");
    await first?.deliver("home", "from personal");
    expect(apiFor("222:bbb").sent.map(({ chatId, text }) => ({ chatId, text }))).toEqual([
      { chatId: 42, text: "from work" },
    ]);
    expect(apiFor("111:aaa").sent.map(({ chatId, text }) => ({ chatId, text }))).toEqual([
      { chatId: 41, text: "from personal" },
    ]);
    await second?.deliver("telegram:work:42", "explicit");
    // A peer key of another account is not this account's destination.
    await expect(second?.deliver("telegram:41", "x")).rejects.toThrow("Unknown delivery target");
    await expect(first?.deliver("telegram:work:42", "x")).rejects.toThrow(
      "Unknown delivery target",
    );
  });

  test("owner keys and labels name the account", async () => {
    const { accounts } = await twoPaired();
    const [first, second] = accounts.services();
    expect(first?.id).toBe("telegram");
    expect(first?.label).toBe("Telegram");
    expect(first?.summary().ownerKey).toBe("telegram:41");
    expect(second?.id).toBe("telegram:work");
    expect(second?.label).toBe("Telegram (Work)");
    expect(second?.summary().ownerKey).toBe("telegram:work:42");
  });
});

describe("forgetting an account", () => {
  test("removes only that account's token, offset and settings, and stops its bot", async () => {
    const { accounts, vault, settings, apiFor } = setup();
    await accounts.save({ ...base, token: "111:aaa" });
    await accounts.save({ ...base, token: "222:bbb", label: "Work" });
    // Each bot saves its poll offset in its own file once it has handled an update.
    apiFor("111:aaa").push(textUpdate(1, "hi", 5));
    apiFor("222:bbb").push(textUpdate(1, "hi", 6));
    await vi.waitFor(() => {
      expect(existsSync(join(directory, "telegram-offset.json"))).toBe(true);
      expect(existsSync(join(directory, "telegram-offset-work.json"))).toBe(true);
    });

    const left = await accounts.forget("work");
    expect(left.map((a) => a.id)).toEqual(["default"]);
    expect(left[0]?.state).toBe("online");
    expect([...vault.entries.keys()]).toEqual(["channel:telegram"]);
    expect(settings.get().channels.telegram.map((a) => a.id)).toEqual(["default"]);
    expect(existsSync(join(directory, "telegram-offset-work.json"))).toBe(false);
    expect(existsSync(join(directory, "telegram-offset.json"))).toBe(true);
  });

  test("the id of a removed account can be used again by a new one", async () => {
    const { accounts, settings } = setup();
    await accounts.save({ ...base, token: "111:aaa" });
    await accounts.save({ ...base, token: "222:bbb", label: "Work" });
    await accounts.forget("work");
    const again = await accounts.save({ ...base, token: "333:ccc", label: "Work" });
    expect(again.id).toBe("work");
    expect(settings.get().channels.telegram.map((a) => a.id)).toEqual(["default", "work"]);
  });

  test("forgetting the first account leaves later ones working", async () => {
    const { accounts, vault } = setup();
    await accounts.save({ ...base, token: "111:aaa" });
    await accounts.save({ ...base, token: "222:bbb", label: "Work" });
    const left = await accounts.forget("default");
    expect(left.map((a) => [a.id, a.state])).toEqual([["work", "online"]]);
    expect([...vault.entries.keys()]).toEqual(["channel:telegram:work"]);
  });
});
