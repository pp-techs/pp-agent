import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_CHANNEL_ACCOUNT_ID,
  DEFAULT_WORKSPACE_ID,
  type ChannelState,
  type SaveTelegramInput,
  type TelegramAccountSettings,
  type TelegramStatus,
} from "@workspace/shared";
import type { VaultCredentialStore } from "../../credentials.ts";
import type { SettingsStore } from "../../settings-store.ts";
import {
  accountDisplayName,
  accountTokenKey,
  chatKeyPrefix,
  offsetFileName,
  upsertAccount,
  type AccountService,
} from "../shared/accounts.ts";
import { BotService } from "../shared/bot-service.ts";
import type { ChannelGateway, ChannelService, ChannelSummary } from "../types.ts";
import { HttpTelegramApi, TelegramApiError, type TelegramApi } from "./api.ts";
import { TelegramChannel, type TelegramOwner } from "./channel.ts";
import { defaultTelegramSettings, readTelegramSettings } from "./settings.ts";
import type { TelegramTranslate } from "./text.ts";

export interface TelegramServiceDeps {
  /** Which account of Telegram this service runs; the first one (`default`) when omitted. */
  accountId?: string;
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
 * Owns one Telegram account (bot): starts it when it is enabled and a token is saved, keeps it in
 * step with the settings, and runs the pairing. Changes are applied one at a time. The first
 * account's chat keys are `telegram:<chat>`, another's `telegram:<account>:<chat>`.
 */
export class TelegramService
  extends BotService<TelegramChannel>
  implements ChannelService, AccountService<TelegramStatus, SaveTelegramInput>
{
  readonly id: string;
  readonly accountId: string;

  constructor(private readonly deps: TelegramServiceDeps) {
    const accountId = deps.accountId ?? DEFAULT_CHANNEL_ACCOUNT_ID;
    super({
      credentials: deps.credentials,
      tokenKey: accountTokenKey("telegram", accountId),
      changed: () => deps.changed(),
    });
    this.accountId = accountId;
    this.id = chatKeyPrefix("telegram", accountId);
  }

  /** "Telegram", or "Telegram (Work)" for an account with a name. */
  get label(): string {
    return accountDisplayName("Telegram", this.account()?.label ?? "");
  }

  /** The saved settings of this account; null before its first save and after it was forgotten. */
  private account(): TelegramAccountSettings | null {
    return (
      this.deps.settings.get().channels.telegram.find((account) => account.id === this.accountId) ??
      null
    );
  }

  protected isEnabled(): boolean {
    return this.account()?.enabled ?? false;
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
      accountId: this.accountId,
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
      this.account() ?? defaultTelegramSettings();
    // A private Telegram chat has the person's user id as its chat id.
    return {
      enabled,
      workspaceId,
      agentId,
      ownerKey: ownerId === null ? null : `${this.id}:${ownerId}`,
      ownerName,
    };
  }

  async status(): Promise<TelegramStatus> {
    const pairing = this.guard.current(Date.now());
    return {
      ...defaultTelegramSettings(),
      id: this.accountId,
      label: "",
      ...this.account(),
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
    const { t } = this.deps;
    const owner = this.owner();
    if (!owner) throw new Error(t("channels.telegram.notifyNeedsOwner"));
    const rest = peer.startsWith(`${this.id}:`) ? peer.slice(this.id.length + 1) : "";
    const chatId = peer === "home" ? owner.id : /^-?[1-9]\d*$/.test(rest) ? Number(rest) : NaN;
    if (
      !Number.isSafeInteger(chatId) ||
      (chatId !== owner.id && !Object.hasOwn(this.account()?.chats ?? {}, String(chatId)))
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
      if (
        (input.enabled || this.account() === null) &&
        token === undefined &&
        (await this.readToken()) === null
      )
        throw new Error(t("channels.telegram.tokenRequired"));

      if (token !== undefined) {
        await this.writeToken(token);
        this.botName = username;
      }
      settings.update((draft) => {
        upsertAccount(draft.channels.telegram, this.accountId, (previous) => ({
          ...defaultTelegramSettings(),
          ...previous,
          id: this.accountId,
          label: input.label?.trim().slice(0, 60) ?? previous?.label ?? "",
          enabled: input.enabled,
          agentId: draft.agents.some((agent) => agent.id === input.agentId) ? input.agentId : null,
          workspaceId: draft.workspaces.some((workspace) => workspace.id === input.workspaceId)
            ? input.workspaceId
            : DEFAULT_WORKSPACE_ID,
          ...(input.chats !== undefined
            ? { chats: readTelegramSettings({ chats: input.chats }).chats ?? {} }
            : {}),
        }));
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

  /** Stops the bot and removes the account: token, saved poll offset and settings. */
  forget(): Promise<void> {
    return this.serial(async () => {
      await this.stopChannel();
      await this.deleteToken();
      if (this.deps.dataDir)
        await rm(join(this.deps.dataDir, offsetFileName("telegram", this.accountId)), {
          force: true,
        });
      this.deps.settings.update((draft) => {
        draft.channels.telegram = draft.channels.telegram.filter(
          (account) => account.id !== this.accountId,
        );
      });
      this.botName = null;
      this.deps.changed();
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
    const { ownerId, ownerName } = this.account() ?? defaultTelegramSettings();
    return ownerId === null ? null : { id: ownerId, name: ownerName ?? String(ownerId) };
  }

  private paired(owner: TelegramOwner): void {
    this.deps.settings.update((draft) => {
      const account = draft.channels.telegram.find((candidate) => candidate.id === this.accountId);
      if (!account) return;
      account.ownerId = owner.id;
      account.ownerName = owner.name;
    });
    this.guard.close();
    this.deps.changed();
  }
}
