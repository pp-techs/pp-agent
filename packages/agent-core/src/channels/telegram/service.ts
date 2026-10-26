import type { ChannelState, SaveTelegramInput, TelegramStatus } from "@workspace/shared";
import type { VaultCredentialStore } from "../../credentials.ts";
import type { SettingsStore } from "../../settings-store.ts";
import { TELEGRAM_TOKEN_KEY } from "../names.ts";
import type { ChannelGateway, TelegramControl } from "../types.ts";
import { HttpTelegramApi, TelegramApiError, type TelegramApi } from "./api.ts";
import { TelegramChannel, type TelegramOwner } from "./channel.ts";
import { PairingGuard } from "./pairing.ts";
import type { TelegramTranslate } from "./text.ts";

export interface TelegramServiceDeps {
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
export class TelegramService implements TelegramControl {
  private channel: TelegramChannel | null = null;
  private channelToken: string | null = null;
  private state: ChannelState = "off";
  private error: string | null = null;
  private botUsername: string | null = null;
  private readonly guard = new PairingGuard();
  private lock: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: TelegramServiceDeps) {}

  /** Starts the channel when it is enabled and has a token. Safe to call again. */
  start(): Promise<void> {
    return this.serial(() => this.reconcile());
  }

  /** Stops the channel. Safe to call again. */
  stop(): Promise<void> {
    return this.serial(() => this.stopChannel());
  }

  async status(): Promise<TelegramStatus> {
    const pairing = this.guard.current(Date.now());
    return {
      ...this.deps.settings.get().channels.telegram,
      hasToken: (await this.readToken()) !== null,
      botUsername: this.botUsername,
      state: this.state,
      error: this.error,
      pairingCode: pairing?.code ?? null,
      pairingExpiresAt: pairing?.expiresAt ?? null,
    };
  }

  save(input: SaveTelegramInput): Promise<TelegramStatus> {
    return this.serial(async () => {
      const { settings, credentials, t } = this.deps;
      const current = settings.get();
      if (input.agentId !== null && !current.agents.some((agent) => agent.id === input.agentId))
        throw new Error(t("channels.telegram.unknownAgent"));
      if (!current.workspaces.some((workspace) => workspace.id === input.workspaceId))
        throw new Error(t("channels.telegram.unknownWorkspace"));

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
        const key = token;
        await credentials.modify(TELEGRAM_TOKEN_KEY, async () => ({ type: "api_key", key }));
        this.botUsername = username;
      }
      settings.update((draft) => {
        draft.channels.telegram = {
          ...draft.channels.telegram,
          enabled: input.enabled,
          agentId: input.agentId,
          workspaceId: input.workspaceId,
        };
      });
      await this.reconcile();
      this.deps.changed();
      return this.status();
    });
  }

  startPairing(): Promise<TelegramStatus> {
    return this.serial(async () => {
      const { t } = this.deps;
      if ((await this.readToken()) === null)
        throw new Error(t("channels.telegram.pairingNeedsToken"));
      if (!this.channel || this.state !== "online")
        throw new Error(t("channels.telegram.pairingNeedsOnline"));
      this.guard.open(Date.now());
      this.deps.changed();
      return this.status();
    });
  }

  forget(): Promise<TelegramStatus> {
    return this.serial(async () => {
      await this.stopChannel();
      if ((await this.readToken()) !== null) await this.deps.credentials.delete(TELEGRAM_TOKEN_KEY);
      this.deps.settings.update((draft) => {
        const telegram = draft.channels.telegram;
        telegram.enabled = false;
        telegram.ownerId = null;
        telegram.ownerName = null;
      });
      this.botUsername = null;
      this.deps.changed();
      return this.status();
    });
  }

  // -------------------------------------------------------------------------------------------

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.lock.then(work);
    this.lock = next.catch(() => {});
    return next;
  }

  private async readToken(): Promise<string | null> {
    const credential = await this.deps.credentials.read(TELEGRAM_TOKEN_KEY);
    return credential?.type === "api_key" && credential.key ? credential.key : null;
  }

  private client(token: string): TelegramApi {
    return this.deps.api?.(token) ?? new HttpTelegramApi(token);
  }

  /** Asks Telegram who the token belongs to; throws a message for the person when it fails. */
  private async verify(token: string): Promise<string | null> {
    const { t } = this.deps;
    try {
      return (await this.client(token).getMe()).username ?? null;
    } catch (error) {
      if (error instanceof TelegramApiError && error.kind === "unauthorized")
        throw new Error(t("channels.telegram.tokenInvalid"));
      throw new Error(t("channels.telegram.unreachable", { error: (error as Error).message }));
    }
  }

  /** Brings the channel in line with the settings and the saved token. */
  private async reconcile(): Promise<void> {
    const enabled = this.deps.settings.get().channels.telegram.enabled;
    const token = await this.readToken();
    if (!enabled || token === null) {
      await this.stopChannel();
      return;
    }
    // A channel in error is restarted, so saving again retries a refused token.
    if (this.channel && this.channelToken === token && this.state !== "error") return;
    await this.stopChannel();

    const channel: TelegramChannel = new TelegramChannel({
      token,
      api: this.deps.api?.(token),
      gateway: this.deps.gateway,
      pairing: this.guard,
      owner: () => this.owner(),
      onPaired: (owner) => this.paired(owner),
      onState: (state, error) => {
        if (this.channel === channel) this.setState(state, error);
      },
      t: this.deps.t,
    });
    this.channel = channel;
    this.channelToken = token;
    const username = await channel.start();
    if (this.channel === channel && username && username !== this.botUsername) {
      this.botUsername = username;
      this.deps.changed();
    }
  }

  private async stopChannel(): Promise<void> {
    const channel = this.channel;
    this.channel = null;
    this.channelToken = null;
    this.guard.close();
    await channel?.stop();
    if (channel) this.setState("off", null);
  }

  private setState(state: ChannelState, error: string | null): void {
    if (this.state === state && this.error === error) return;
    this.state = state;
    this.error = error;
    this.deps.changed();
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
