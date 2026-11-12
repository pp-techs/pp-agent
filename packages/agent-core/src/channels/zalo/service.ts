import {
  DEFAULT_CHANNEL_ACCOUNT_ID,
  DEFAULT_WORKSPACE_ID,
  type ChannelState,
  type SaveZaloInput,
  type ZaloAccountSettings,
  type ZaloStatus,
} from "@workspace/shared";
import type { VaultCredentialStore } from "../../credentials.ts";
import type { SettingsStore } from "../../settings-store.ts";
import {
  accountDisplayName,
  accountTokenKey,
  chatKeyPrefix,
  upsertAccount,
  type AccountService,
} from "../shared/accounts.ts";
import { BotService } from "../shared/bot-service.ts";
import type { ChannelGateway, ChannelService, ChannelSummary } from "../types.ts";
import { HttpZaloApi, ZaloApiError, type ZaloApi } from "./api.ts";
import { ZaloChannel, type ZaloOwner } from "./channel.ts";
import { defaultZaloSettings, readZaloSettings } from "./settings.ts";
import type { ZaloTranslate } from "./text.ts";

export interface ZaloServiceDeps {
  /** Which account of Zalo this service runs; the first one (`default`) when omitted. */
  accountId?: string;
  settings: SettingsStore;
  credentials: Pick<VaultCredentialStore, "read" | "modify" | "delete">;
  gateway: ChannelGateway;
  /** Tells the clients that the Zalo settings or status changed (`settings_changed`). */
  changed(): void;
  t: ZaloTranslate;
  /** Builds the Bot API client for a token; the HTTP client by default (tests fake it). */
  api?: (token: string) => ZaloApi;
}

/**
 * Owns one Zalo account (bot): starts it when it is enabled and a token is saved, keeps it in step
 * with the settings, and runs the pairing. Changes are applied one at a time. The first account's
 * chat keys are `zalo:<chat>`, another's `zalo:<account>:<chat>`.
 */
export class ZaloService
  extends BotService<ZaloChannel>
  implements ChannelService, AccountService<ZaloStatus, SaveZaloInput>
{
  readonly id: string;
  readonly accountId: string;

  constructor(private readonly deps: ZaloServiceDeps) {
    const accountId = deps.accountId ?? DEFAULT_CHANNEL_ACCOUNT_ID;
    super({
      credentials: deps.credentials,
      tokenKey: accountTokenKey("zalo", accountId),
      changed: () => deps.changed(),
    });
    this.accountId = accountId;
    this.id = chatKeyPrefix("zalo", accountId);
  }

  /** "Zalo", or "Zalo (Work)" for an account with a name. */
  get label(): string {
    return accountDisplayName("Zalo", this.account()?.label ?? "");
  }

  /** The saved settings of this account; null before its first save and after it was forgotten. */
  private account(): ZaloAccountSettings | null {
    return (
      this.deps.settings.get().channels.zalo.find((account) => account.id === this.accountId) ??
      null
    );
  }

  protected isEnabled(): boolean {
    return this.account()?.enabled ?? false;
  }

  protected pairingNeedsToken(): string {
    return this.deps.t("channels.zalo.pairingNeedsToken");
  }

  protected pairingNeedsOnline(): string {
    return this.deps.t("channels.zalo.pairingNeedsOnline");
  }

  protected createChannel(
    token: string,
    onState: (state: ChannelState, error: string | null) => void,
  ): ZaloChannel {
    return new ZaloChannel({
      token,
      accountId: this.accountId,
      api: this.deps.api?.(token),
      gateway: this.deps.gateway,
      pairing: this.guard,
      owner: () => this.owner(),
      onPaired: (owner) => this.paired(owner),
      onState,
      t: this.deps.t,
      settings: this.deps.settings,
    });
  }

  summary(): ChannelSummary {
    const { enabled, workspaceId, agentId, ownerId, ownerName } =
      this.account() ?? defaultZaloSettings();
    return {
      enabled,
      workspaceId,
      agentId,
      ownerKey: ownerId === null ? null : `${this.id}:${ownerId}`,
      ownerName,
    };
  }

  async status(): Promise<ZaloStatus> {
    const pairing = this.guard.current(Date.now());
    return {
      ...defaultZaloSettings(),
      id: this.accountId,
      label: "",
      ...this.account(),
      hasToken: (await this.readToken()) !== null,
      botName: this.botName,
      state: this.state,
      error: this.error,
      pairingCode: pairing?.code ?? null,
      pairingExpiresAt: pairing?.expiresAt ?? null,
    };
  }

  /** Sends to the paired owner (`home`) or an explicitly configured Zalo chat. */
  async deliver(peer: string, text: string): Promise<void> {
    const { t } = this.deps;
    const owner = this.owner();
    if (!owner) throw new Error(t("channels.zalo.notifyNeedsOwner"));
    const rest = peer.startsWith(`${this.id}:`) ? peer.slice(this.id.length + 1) : "";
    const chatId = peer === "home" ? owner.id : rest || null;
    if (!chatId || (chatId !== owner.id && !Object.hasOwn(this.account()?.chats ?? {}, chatId))) {
      throw new Error(`Unknown delivery target: ${peer}`);
    }
    const channel = this.onlineChannel;
    if (!channel) throw new Error(t("channels.zalo.notifyNeedsOnline"));
    try {
      await channel.notify(chatId, text);
    } catch (error) {
      throw new Error(t("channels.zalo.notifyFailed", { error: (error as Error).message }));
    }
  }

  save(input: SaveZaloInput): Promise<ZaloStatus> {
    return this.serial(async () => {
      const { settings, t } = this.deps;
      let token: string | undefined;
      let botName: string | null = null;
      if (input.token !== undefined) {
        token = input.token.trim();
        if (!token) throw new Error(t("channels.zalo.tokenRequired"));
        botName = await this.verify(token);
      }
      if (
        (input.enabled || this.account() === null) &&
        token === undefined &&
        (await this.readToken()) === null
      )
        throw new Error(t("channels.zalo.tokenRequired"));

      if (token !== undefined) {
        await this.writeToken(token);
        this.botName = botName;
      }
      settings.update((draft) => {
        upsertAccount(draft.channels.zalo, this.accountId, (previous) => ({
          ...defaultZaloSettings(),
          ...previous,
          id: this.accountId,
          label: input.label?.trim().slice(0, 60) ?? previous?.label ?? "",
          enabled: input.enabled,
          agentId: draft.agents.some((agent) => agent.id === input.agentId) ? input.agentId : null,
          workspaceId: draft.workspaces.some((workspace) => workspace.id === input.workspaceId)
            ? input.workspaceId
            : DEFAULT_WORKSPACE_ID,
          ...(input.chats !== undefined
            ? { chats: readZaloSettings({ chats: input.chats }).chats ?? {} }
            : {}),
        }));
      });
      await this.reconcile();
      this.deps.changed();
      return this.status();
    });
  }

  startPairing(): Promise<ZaloStatus> {
    return this.serial(async () => {
      await this.openPairing();
      return this.status();
    });
  }

  /** Stops the bot and removes the account: token and settings. */
  forget(): Promise<void> {
    return this.serial(async () => {
      await this.stopChannel();
      await this.deleteToken();
      this.deps.settings.update((draft) => {
        draft.channels.zalo = draft.channels.zalo.filter(
          (account) => account.id !== this.accountId,
        );
      });
      this.botName = null;
      this.deps.changed();
    });
  }

  // -------------------------------------------------------------------------------------------

  /** Asks Zalo who the token belongs to; throws a message for the person when it fails. */
  private async verify(token: string): Promise<string | null> {
    const { t } = this.deps;
    try {
      const api = this.deps.api?.(token) ?? new HttpZaloApi(token);
      return (await api.getMe()).account_name ?? null;
    } catch (error) {
      if (error instanceof ZaloApiError && error.kind === "unauthorized")
        throw new Error(t("channels.zalo.tokenInvalid"));
      throw new Error(t("channels.zalo.unreachable", { error: (error as Error).message }));
    }
  }

  private owner(): ZaloOwner | null {
    const { ownerId, ownerName } = this.account() ?? defaultZaloSettings();
    return ownerId === null ? null : { id: ownerId, name: ownerName ?? ownerId };
  }

  private paired(owner: ZaloOwner): void {
    this.deps.settings.update((draft) => {
      const account = draft.channels.zalo.find((candidate) => candidate.id === this.accountId);
      if (!account) return;
      account.ownerId = owner.id;
      account.ownerName = owner.name;
    });
    this.guard.close();
    this.deps.changed();
  }
}
