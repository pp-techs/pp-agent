import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Credential } from "@earendil-works/pi-ai";
import { DEFAULT_AGENT_ID, DEFAULT_WORKSPACE_ID } from "@workspace/shared";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { SettingsStore } from "../../settings-store.ts";
import { TELEGRAM_TOKEN_KEY } from "../names.ts";
import { TelegramApiError } from "./api.ts";
import { TelegramService } from "./service.ts";
import { FakeApi, FakeGateway, fakeT, textUpdate } from "./testing.ts";

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
const services: TelegramService[] = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "pp-telegram-service-"));
});

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stop()));
  rmSync(directory, { recursive: true, force: true });
});

function setup() {
  const settings = new SettingsStore(join(directory, "settings.json"));
  const vault = new FakeVault();
  const api = new FakeApi();
  const gateway = new FakeGateway();
  const changed = vi.fn();
  const tokens: string[] = [];
  const service = new TelegramService({
    dataDir: directory,
    settings,
    credentials: vault,
    gateway,
    changed,
    t: fakeT,
    api: (token) => {
      tokens.push(token);
      return api;
    },
  });
  services.push(service);
  return { settings, vault, api, gateway, changed, tokens, service };
}

const input = {
  token: "123:abc",
  enabled: true,
  agentId: DEFAULT_AGENT_ID,
  workspaceId: DEFAULT_WORKSPACE_ID,
};

describe("save", () => {
  test("verifies the token with getMe, stores it, starts the channel and reports status", async () => {
    const { service, vault, settings, changed, tokens } = setup();
    const status = await service.save(input);
    expect(tokens).toContain("123:abc");
    expect(vault.entries.get(TELEGRAM_TOKEN_KEY)).toEqual({ type: "api_key", key: "123:abc" });
    expect(settings.get().channels.telegram.enabled).toBe(true);
    expect(status).toMatchObject({
      enabled: true,
      hasToken: true,
      botUsername: "pp_bot",
      state: "online",
      error: null,
      pairingCode: null,
    });
    expect(changed).toHaveBeenCalled();
  });

  test("does not store a token that Telegram refuses", async () => {
    const { service, vault, settings, api } = setup();
    api.getMeError = new TelegramApiError("unauthorized", "Unauthorized", 401);
    await expect(service.save(input)).rejects.toThrow("channels.telegram.tokenInvalid");
    expect(vault.entries.size).toBe(0);
    expect(settings.get().channels.telegram.enabled).toBe(false);
    expect((await service.status()).hasToken).toBe(false);
  });

  test("reports an unreachable Telegram readably", async () => {
    const { service, vault, api } = setup();
    api.getMeError = new TelegramApiError("network", "fetch failed");
    await expect(service.save(input)).rejects.toThrow("channels.telegram.unreachable");
    expect(vault.entries.size).toBe(0);
  });

  test("no pinned agent means the agent follows the workspace", async () => {
    const { service, settings } = setup();
    await expect(service.save({ ...input, agentId: null })).resolves.toMatchObject({
      agentId: null,
    });
    expect(settings.get().channels.telegram.agentId).toBeNull();
  });

  test("normalizes deleted agent and workspace IDs on save", async () => {
    const { service, settings } = setup();
    settings.update((draft) => {
      draft.channels.telegram.agentId = "deleted-agent";
      draft.channels.telegram.workspaceId = "deleted-workspace";
    });
    const saved = await service.save({
      ...input,
      agentId: "deleted-agent",
      workspaceId: "deleted-workspace",
    });
    expect(saved.agentId).toBeNull();
    expect(saved.workspaceId).toBe(DEFAULT_WORKSPACE_ID);
    expect(settings.get().channels.telegram).toMatchObject({
      agentId: null,
      workspaceId: DEFAULT_WORKSPACE_ID,
    });
  });

  test("rejects an empty token", async () => {
    const { service, settings } = setup();
    await expect(service.save({ ...input, token: "  " })).rejects.toThrow(
      "channels.telegram.tokenRequired",
    );
    expect(settings.get().channels.telegram.enabled).toBe(false);
  });

  test("cannot be enabled without a token, but can keep the stored one when omitted", async () => {
    const { service, api } = setup();
    const { token: _token, ...withoutToken } = input;
    await expect(service.save(withoutToken)).rejects.toThrow("channels.telegram.tokenRequired");
    await service.save(input);
    api.me = { ...api.me, username: "other_bot" };
    const status = await service.save({ ...withoutToken, enabled: false });
    expect(status).toMatchObject({ enabled: false, hasToken: true, state: "off" });
  });

  test("turning it off stops the channel", async () => {
    const { service, api } = setup();
    await service.save(input);
    const status = await service.save({ ...input, token: undefined, enabled: false });
    expect(status.state).toBe("off");
    const webhookCalls = api.webhookDeleted;
    await service.save({ ...input, token: undefined, enabled: true });
    expect(api.webhookDeleted).toBe(webhookCalls + 1);
  });
});

describe("start and stop", () => {
  test("start runs the channel only when enabled with a token, and is idempotent", async () => {
    const { service, settings, vault, api } = setup();
    await service.start();
    expect((await service.status()).state).toBe("off");

    vault.entries.set(TELEGRAM_TOKEN_KEY, { type: "api_key", key: "123:abc" });
    settings.update((draft) => {
      draft.channels.telegram.enabled = true;
    });
    await service.start();
    await service.start();
    expect((await service.status()).state).toBe("online");
    expect(api.webhookDeleted).toBe(1);

    await service.stop();
    await service.stop();
    expect((await service.status()).state).toBe("off");
  });
});

describe("pairing", () => {
  test("needs a token and an online channel", async () => {
    const { service } = setup();
    await expect(service.startPairing()).rejects.toThrow("channels.telegram.pairingNeedsToken");
    await service.save({ ...input, enabled: false });
    await expect(service.startPairing()).rejects.toThrow("channels.telegram.pairingNeedsOnline");
  });

  test("a code sent to the bot makes that person the owner", async () => {
    const { service, api, settings, changed } = setup();
    await service.save(input);
    const open = await service.startPairing();
    expect(open.pairingCode).toMatch(/^[A-Z2-9]{8}$/);
    expect(open.pairingExpiresAt).toBeGreaterThan(Date.now());

    api.push(textUpdate(1, `/pair ${open.pairingCode}`, 42));
    await vi.waitFor(() => expect(settings.get().channels.telegram.ownerId).toBe(42));
    expect(settings.get().channels.telegram.ownerName).toBe("Ann Lee");
    const status = await service.status();
    expect(status).toMatchObject({ ownerId: 42, ownerName: "Ann Lee", pairingCode: null });
    expect(changed).toHaveBeenCalled();
  });

  test("only the owner is answered afterwards", async () => {
    const { service, api, gateway } = setup();
    await service.save(input);
    const { pairingCode } = await service.startPairing();
    api.push(textUpdate(1, `/pair ${pairingCode}`, 42));
    await vi.waitFor(() => expect(api.sent).toHaveLength(1));
    api.push(textUpdate(2, "hi", 43));
    api.push(textUpdate(3, "hi", 42));
    await vi.waitFor(() => expect(gateway.turns).toHaveLength(1));
    expect(gateway.turns[0]?.chatKey).toBe("telegram:42");
  });
});

describe("delivery", () => {
  async function paired() {
    const context = setup();
    await context.service.save(input);
    const { pairingCode } = await context.service.startPairing();
    context.api.push(textUpdate(1, `/pair ${pairingCode}`, 42));
    await vi.waitFor(() => expect(context.settings.get().channels.telegram.ownerId).toBe(42));
    context.api.sent.length = 0;
    return context;
  }

  test("sends to the owner's private chat, split below Telegram's limit", async () => {
    const { service, api } = await paired();
    await service.deliver("home", `${"a".repeat(3_000)}\n\n${"b".repeat(3_000)}`);
    expect(api.sent.map((message) => message.chatId)).toEqual([42, 42]);
    expect(api.sent.every((message) => message.text.length <= 4096)).toBe(true);
  });

  test("is refused before pairing and while the channel is off", async () => {
    const { service } = setup();
    await expect(service.deliver("home", "hi")).rejects.toThrow(
      "channels.telegram.notifyNeedsOwner",
    );
    const context = await paired();
    await context.service.save({ ...input, enabled: false });
    await expect(context.service.deliver("home", "hi")).rejects.toThrow(
      "channels.telegram.notifyNeedsOnline",
    );
    expect(context.api.sent).toHaveLength(0);
  });

  test("reports a send that Telegram refuses", async () => {
    const { service, api } = await paired();
    api.sendError = () => new TelegramApiError("network", "fetch failed");
    await expect(service.deliver("home", "hi")).rejects.toThrow("channels.telegram.notifyFailed");
  });

  test("sends to the selected configured group rather than the owner", async () => {
    const { service, settings, api } = await paired();
    settings.update((draft) => {
      draft.channels.telegram.chats = { "-100456": { label: "Reports", access: "owner" } };
    });
    await service.deliver("telegram:-100456", "Morning report");
    expect(api.sent.map(({ chatId, text }) => ({ chatId, text }))).toEqual([
      { chatId: -100456, text: "Morning report" },
    ]);
  });

  test("rejects unknown or malformed destinations without sending to the owner", async () => {
    const { service, api } = await paired();
    for (const peer of ["telegram:99", "telegram:42:other", "telegram:", "slack:42"]) {
      await expect(service.deliver(peer, "private result")).rejects.toThrow(
        "Unknown delivery target",
      );
    }
    expect(api.sent).toEqual([]);
    await service.deliver("telegram:42", "Owner report");
    expect(api.sent.map(({ chatId }) => chatId)).toEqual([42]);
  });
});

describe("forget", () => {
  test("removes the token and owner, disables and stops", async () => {
    const { service, vault, settings, api } = setup();
    await service.save(input);
    const { pairingCode } = await service.startPairing();
    api.push(textUpdate(1, `/pair ${pairingCode}`, 42));
    await vi.waitFor(() => expect(settings.get().channels.telegram.ownerId).toBe(42));

    const status = await service.forget();
    expect(vault.entries.size).toBe(0);
    expect(status).toMatchObject({
      enabled: false,
      hasToken: false,
      ownerId: null,
      ownerName: null,
      botUsername: null,
      state: "off",
    });
    expect(settings.get().channels.telegram.agentId).toBe(DEFAULT_AGENT_ID);
  });

  test("works when nothing was saved", async () => {
    const { service } = setup();
    await expect(service.forget()).resolves.toMatchObject({ hasToken: false, state: "off" });
  });
});

describe("settings file", () => {
  test("reads channels leniently and keeps them on write", () => {
    const path = join(directory, "settings.json");
    const store = new SettingsStore(path);
    expect(store.get().channels.telegram).toEqual({
      enabled: false,
      agentId: null,
      workspaceId: DEFAULT_WORKSPACE_ID,
      ownerId: null,
      ownerName: null,
    });
    store.update((draft) => {
      draft.channels.telegram.ownerId = 5;
      draft.channels.telegram.ownerName = "Ann";
    });
    expect(new SettingsStore(path).get().channels.telegram).toMatchObject({
      ownerId: 5,
      ownerName: "Ann",
    });
  });
});
