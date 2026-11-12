import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Credential } from "@earendil-works/pi-ai";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_WORKSPACE_ID,
  type SaveZaloInput,
  type ZaloStatus,
} from "@workspace/shared";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { SettingsStore } from "../../settings-store.ts";
import { ChannelAccounts } from "../shared/accounts.ts";
import { FakeGateway } from "../shared/testing.ts";
import { ZaloService } from "./service.ts";
import { FakeZaloApi, fakeT, textUpdate } from "./testing.ts";

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
  directory = mkdtempSync(join(tmpdir(), "pp-zalo-accounts-"));
});

afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()));
  rmSync(directory, { recursive: true, force: true });
});

function setup() {
  const settings = new SettingsStore(join(directory, "settings.json"));
  const vault = new FakeVault();
  const gateway = new FakeGateway();
  const apis = new Map<string, FakeZaloApi>();
  const apiFor = (token: string) => {
    let api = apis.get(token);
    if (!api) {
      api = new FakeZaloApi();
      api.me = { id: String(apis.size + 1), account_name: `bot.${apis.size + 1}` };
      apis.set(token, api);
    }
    return api;
  };
  const accounts = new ChannelAccounts<ZaloStatus, SaveZaloInput>({
    saved: () => settings.get().channels.zalo,
    create: (accountId) => {
      const service = new ZaloService({
        accountId,
        settings,
        credentials: vault,
        gateway,
        changed: vi.fn(),
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

const base = { enabled: true, agentId: DEFAULT_AGENT_ID, workspaceId: DEFAULT_WORKSPACE_ID };

describe("Zalo accounts", () => {
  test("the first account keeps the old vault id, a second gets its own", async () => {
    const { accounts, vault } = setup();
    const first = await accounts.save({ ...base, token: "111:aaa" });
    const second = await accounts.save({ ...base, token: "222:bbb", label: "Shop" });
    expect([first.id, second.id]).toEqual(["default", "shop"]);
    expect([...vault.entries.keys()].sort()).toEqual(["channel:zalo", "channel:zalo:shop"]);
    expect((await accounts.list()).map((a) => [a.id, a.botName, a.state])).toEqual([
      ["default", "bot.1", "online"],
      ["shop", "bot.2", "online"],
    ]);
  });

  test("refuses a token that another account already uses", async () => {
    const { accounts } = setup();
    await accounts.save({ ...base, token: "111:aaa" });
    await expect(accounts.save({ ...base, token: "111:aaa", label: "Copy" })).rejects.toThrow(
      "token in use",
    );
  });

  test("each bot has its own owner, chat keys and delivery", async () => {
    const { accounts, settings, apiFor, gateway } = setup();
    await accounts.save({ ...base, token: "111:aaa" });
    await accounts.save({ ...base, token: "222:bbb", label: "Shop" });
    for (const [id, token, user] of [
      ["default", "111:aaa", "u1"],
      ["shop", "222:bbb", "u2"],
    ] as const) {
      const { pairingCode } = await accounts.startPairing(id);
      apiFor(token).push(textUpdate(1, `/pair ${pairingCode}`, user));
      await vi.waitFor(() =>
        expect(settings.get().channels.zalo.find((a) => a.id === id)?.ownerId).toBe(user),
      );
      apiFor(token).sent.length = 0;
    }

    apiFor("111:aaa").push(textUpdate(2, "one", "u1"));
    apiFor("222:bbb").push(textUpdate(2, "two", "u2"));
    await vi.waitFor(() => expect(gateway.turns).toHaveLength(2));
    expect(gateway.turns.map((turn) => turn.chatKey).sort()).toEqual(["zalo:shop:u2", "zalo:u1"]);

    const [first, second] = accounts.services();
    expect(first?.summary().ownerKey).toBe("zalo:u1");
    expect(second?.summary().ownerKey).toBe("zalo:shop:u2");
    expect(second?.label).toBe("Zalo (Shop)");
    await second?.deliver("home", "from shop");
    expect(apiFor("222:bbb").sent.map((m) => m.text)).toContain("from shop");
    expect(apiFor("111:aaa").sent.map((m) => m.text)).not.toContain("from shop");
    await expect(first?.deliver("zalo:shop:u2", "x")).rejects.toThrow("Unknown delivery target");
  });

  test("forgetting an account removes only its token and settings", async () => {
    const { accounts, vault, settings } = setup();
    await accounts.save({ ...base, token: "111:aaa" });
    await accounts.save({ ...base, token: "222:bbb", label: "Shop" });
    const left = await accounts.forget("shop");
    expect(left.map((a) => a.id)).toEqual(["default"]);
    expect([...vault.entries.keys()]).toEqual(["channel:zalo"]);
    expect(settings.get().channels.zalo.map((a) => a.id)).toEqual(["default"]);
  });
});
