import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_WORKSPACE_ID,
  type ChannelState,
  type SaveTelegramInput,
  type TelegramStatus,
} from "@workspace/shared";
import type { VaultCredentialStore } from "../../credentials.ts";
import type { SettingsStore } from "../../settings-store.ts";
import { TELEGRAM_TOKEN_KEY } from "../names.ts";
import { BotService } from "../shared/bot-service.ts";
import type { ChannelGateway, ChannelService, ChannelSummary } from "../types.ts";
import { HttpTelegramApi, TelegramApiError, type TelegramApi } from "./api.ts";
import { TelegramChannel, type TelegramOwner } from "./channel.ts";
import { readTelegramSettings } from "./settings.ts";
import type { TelegramTranslate } from "./text.ts";

export interface TelegramServiceDeps {
  /** Where to persist the poll offset. */
  dataDir?: string;
  settings: SettingsStore;
  credentials: Pick<VaultCredentialStore, "read" | "modify" | "delete">;
  gateway: ChannelGateway;
  /** Tells the clients that the Telegram settings or status changed (`settings_changed`). */
  changed(): void;
  t: TelegramTranslate;
  /** Builds the Bot API client for a token; the HTTP client by default (tests fake it). */
  api?: (token: string) => TelegramApi;
}

/**
 * Owns the Telegram channel: starts it when it is enabled and a token is saved, keeps it in step
 * with the settings, and runs the pairing. Changes are applied one at a time.
 */
export class TelegramService extends BotService<TelegramChannel> implements ChannelService {
  readonly id = "telegram";
  readonly label = "Telegram";

  constructor(private readonly deps: TelegramServiceDeps) {
    super({
      credentials: deps.credentials,
      tokenKey: TELEGRAM_TOKEN_KEY,
      changed: () => deps.changed(),
    });
  }

  protected isEnabled(): boolean {
    return this.deps.settings.get().channels.telegram.enabled;
  }

  protected pairingNeedsToken(): string {
    return this.deps.t("channels.telegram.pairingNeedsToken");
  }

  protected pairingNeedsOnline(): string {
    return this.deps.t("channels.telegram.pairingNeedsOnline");
  }

  protected createChannel(
    token: string,
    onState: (state: ChannelState, error: string | null) => void,
  ): TelegramChannel {
    return new TelegramChannel({
      dataDir: this.deps.dataDir,
      settings: this.deps.settings,
      token,
      api: this.deps.api?.(token),
      gateway: this.deps.gateway,
      pairing: this.guard,
      owner: () => this.owner(),
      onPaired: (owner) => this.paired(owner),
      onState,
      t: this.deps.t,
    });
  }

  summary(): ChannelSummary {
    const { enabled, workspaceId, agentId, ownerId, ownerName } =
      this.deps.settings.get().channels.telegram;
    // A private Telegram chat has the person's user id as its chat id.
    return {
      enabled,
      workspaceId,
      agentId,
      ownerKey: ownerId === null ? null : `telegram:${ownerId}`,
      ownerName,
    };
  }

  async status(): Promise<TelegramStatus> {
    const pairing = this.guard.current(Date.now());
    return {
      ...this.deps.settings.get().channels.telegram,
      hasToken: (await this.readToken()) !== null,
      botUsername: this.botName,
      state: this.state,
      error: this.error,
      pairingCode: pairing?.code ?? null,
      pairingExpiresAt: pairing?.expiresAt ?? null,
    };
  }

  /** Sends to the paired owner (`home`) or an explicitly configured Telegram chat. */
  async deliver(peer: string, text: string): Promise<void> {
    const { t, settings } = this.deps;
    const owner = this.owner();
    if (!owner) throw new Error(t("channels.telegram.notifyNeedsOwner"));
    const match = /^telegram:(-?[1-9]\d*)$/.exec(peer);
    const chatId = peer === "home" ? owner.id : match ? Number(match[1]) : NaN;
    if (
      !Number.isSafeInteger(chatId) ||
      (chatId !== owner.id &&
        !Object.hasOwn(settings.get().channels.telegram.chats ?? {}, String(chatId)))
    ) {
      throw new Error(`Unknown delivery target: ${peer}`);
    }
    const channel = this.onlineChannel;
    if (!channel) throw new Error(t("channels.telegram.notifyNeedsOnline"));
    try {
      await channel.notify(chatId, text);
    } catch (error) {
      throw new Error(t("channels.telegram.notifyFailed", { error: (error as Error).message }));
    }
  }

  save(input: SaveTelegramInput): Promise<TelegramStatus> {
    return this.serial(async () => {
      const { settings, t } = this.deps;
      let token: string | undefined;
      let username: string | null = null;
      if (input.token !== undefined) {
        token = input.token.trim();
        if (!token) throw new Error(t("channels.telegram.tokenRequired"));
        username = await this.verify(token);
      }
      if (input.enabled && token === undefined && (await this.readToken()) === null)
        throw new Error(t("channels.telegram.tokenRequired"));

      if (token !== undefined) {
        await this.writeToken(token);
        this.botName = username;
      }
      settings.update((draft) => {
        draft.channels.telegram = {
          ...draft.channels.telegram,
          enabled: input.enabled,
          agentId: draft.agents.some((agent) => agent.id === input.agentId) ? input.agentId : null,
          workspaceId: draft.workspaces.some((workspace) => workspace.id === input.workspaceId)
            ? input.workspaceId
            : DEFAULT_WORKSPACE_ID,
          ...(input.chats !== undefined
            ? { chats: readTelegramSettings({ chats: input.chats }).chats ?? {} }
            : {}),
        };
      });
      await this.reconcile();
      this.deps.changed();
      return this.status();
    });
  }

  startPairing(): Promise<TelegramStatus> {
    return this.serial(async () => {
      await this.openPairing();
      return this.status();
    });
  }

  forget(): Promise<TelegramStatus> {
    return this.serial(async () => {
      await this.stopChannel();
      await this.deleteToken();
      if (this.deps.dataDir)
        await rm(join(this.deps.dataDir, "telegram-offset.json"), { force: true });
      this.deps.settings.update((draft) => {
        const telegram = draft.channels.telegram;
        telegram.enabled = false;
        telegram.ownerId = null;
        telegram.ownerName = null;
      });
      this.botName = null;
      this.deps.changed();
      return this.status();
    });
  }

  // -------------------------------------------------------------------------------------------

  /** Asks Telegram who the token belongs to; throws a message for the person when it fails. */
  private async verify(token: string): Promise<string | null> {
    const { t } = this.deps;
    try {
      const api = this.deps.api?.(token) ?? new HttpTelegramApi(token);
      return (await api.getMe()).username ?? null;
    } catch (error) {
      if (error instanceof TelegramApiError && error.kind === "unauthorized")
        throw new Error(t("channels.telegram.tokenInvalid"));
      throw new Error(t("channels.telegram.unreachable", { error: (error as Error).message }));
    }
  }

  private owner(): TelegramOwner | null {
    const { ownerId, ownerName } = this.deps.settings.get().channels.telegram;
    return ownerId === null ? null : { id: ownerId, name: ownerName ?? String(ownerId) };
  }

  private paired(owner: TelegramOwner): void {
    this.deps.settings.update((draft) => {
      draft.channels.telegram.ownerId = owner.id;
      draft.channels.telegram.ownerName = owner.name;
    });
    this.guard.close();
    this.deps.changed();
  }
}
