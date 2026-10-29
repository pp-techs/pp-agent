import type { ChannelState } from "@workspace/shared";
import type { VaultCredentialStore } from "../../credentials.ts";
import { PairingGuard } from "./pairing.ts";

/** What a service needs from the bot it runs. */
export interface BotChannel {
  /** Connects and starts polling; resolves with the bot's name, or null when it is not known yet. */
  start(): Promise<string | null>;
  stop(): Promise<void>;
}

export interface BotServiceBase {
  credentials: Pick<VaultCredentialStore, "read" | "modify" | "delete">;
  /** Vault id of the bot token. */
  tokenKey: string;
  /** Tells the clients that the channel's settings or status changed (`settings_changed`). */
  changed(): void;
}

/**
 * What every polling chat bot service does: starts its channel when it is enabled and has a token,
 * keeps it in step with the settings, holds the pairing code, and applies changes one at a time.
 * A concrete service adds the channel's own settings, status, and delivery.
 */
export abstract class BotService<C extends BotChannel> {
  protected channel: C | null = null;
  private channelToken: string | null = null;
  protected state: ChannelState = "off";
  protected error: string | null = null;
  /** The bot's own name or username, once the token has been accepted. */
  protected botName: string | null = null;
  protected readonly guard = new PairingGuard();
  private lock: Promise<unknown> = Promise.resolve();

  protected constructor(private readonly base: BotServiceBase) {}

  /** True when the person turned the channel on in Settings. */
  protected abstract isEnabled(): boolean;
  /** Builds the channel for a token. It must report every state change through `onState`. */
  protected abstract createChannel(
    token: string,
    onState: (state: ChannelState, error: string | null) => void,
  ): C;
  /** The sentences for a pairing that cannot start. */
  protected abstract pairingNeedsToken(): string;
  protected abstract pairingNeedsOnline(): string;

  /** Starts the channel when it is enabled and has a token. Safe to call again. */
  start(): Promise<void> {
    return this.serial(() => this.reconcile());
  }

  /** Stops the channel. Safe to call again. */
  stop(): Promise<void> {
    return this.serial(() => this.stopChannel());
  }

  /** Runs `work` after the changes already queued, so settings and the channel never race. */
  protected serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.lock.then(work);
    this.lock = next.catch(() => {});
    return next;
  }

  protected async readToken(): Promise<string | null> {
    const credential = await this.base.credentials.read(this.base.tokenKey);
    return credential?.type === "api_key" && credential.key ? credential.key : null;
  }

  protected async writeToken(key: string): Promise<void> {
    await this.base.credentials.modify(this.base.tokenKey, async () => ({ type: "api_key", key }));
  }

  protected async deleteToken(): Promise<void> {
    if ((await this.readToken()) !== null) await this.base.credentials.delete(this.base.tokenKey);
  }

  /** Opens the pairing window; throws a message for the person when the channel is not ready. */
  protected async openPairing(): Promise<void> {
    if ((await this.readToken()) === null) throw new Error(this.pairingNeedsToken());
    if (!this.channel || this.state !== "online") throw new Error(this.pairingNeedsOnline());
    this.guard.open(Date.now());
    this.base.changed();
  }

  /** The channel, when it is running and online, for delivering a message. */
  protected get onlineChannel(): C | null {
    return this.channel && this.state === "online" ? this.channel : null;
  }

  /** Brings the channel in line with the settings and the saved token. */
  protected async reconcile(): Promise<void> {
    const token = await this.readToken();
    if (!this.isEnabled() || token === null) {
      await this.stopChannel();
      return;
    }
    // A channel in error is restarted, so saving again retries a refused token.
    if (this.channel && this.channelToken === token && this.state !== "error") return;
    await this.stopChannel();

    const channel: C = this.createChannel(token, (state, error) => {
      if (this.channel === channel) this.setState(state, error);
    });
    this.channel = channel;
    this.channelToken = token;
    const name = await channel.start();
    if (this.channel === channel && name && name !== this.botName) {
      this.botName = name;
      this.base.changed();
    }
  }

  protected async stopChannel(): Promise<void> {
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
    this.base.changed();
  }
}
