import {
  DEFAULT_WORKSPACE_ID,
  type ChannelState,
  type SaveZaloInput,
  type ZaloStatus,
} from "@workspace/shared";
import type { VaultCredentialStore } from "../../credentials.ts";
import type { SettingsStore } from "../../settings-store.ts";
import { ZALO_TOKEN_KEY } from "../names.ts";
import { BotService } from "../shared/bot-service.ts";
import type { ChannelGateway, ChannelService, ChannelSummary } from "../types.ts";
import { HttpZaloApi, ZaloApiError, type ZaloApi } from "./api.ts";
import { ZaloChannel, type ZaloOwner } from "./channel.ts";
import type { ZaloTranslate } from "./text.ts";

export interface ZaloServiceDeps {
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
 * Owns the Zalo channel: starts it when it is enabled and a token is saved, keeps it in step with
 * the settings, and runs the pairing. Changes are applied one at a time.
 */
export class ZaloService extends BotService<ZaloChannel> implements ChannelService {
  readonly id = "zalo";
  readonly label = "Zalo";

  constructor(private readonly deps: ZaloServiceDeps) {
    super({
      credentials: deps.credentials,
      tokenKey: ZALO_TOKEN_KEY,
      changed: () => deps.changed(),
    });
  }

  protected isEnabled(): boolean {
    return this.deps.settings.get().channels.zalo.enabled;
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
      this.deps.settings.get().channels.zalo;
    return {
      enabled,
      workspaceId,
      agentId,
      ownerKey: ownerId === null ? null : `zalo:${ownerId}`,
      ownerName,
    };
  }

  async status(): Promise<ZaloStatus> {
    const pairing = this.guard.current(Date.now());
    return {
      ...this.deps.settings.get().channels.zalo,
      hasToken: (await this.readToken()) !== null,
      botName: this.botName,
      state: this.state,
      error: this.error,
      pairingCode: pairing?.code ?? null,
      pairingExpiresAt: pairing?.expiresAt ?? null,
    };
  }

  /** Sends to the paired owner: `home`, or `zalo:<owner id>`. */
  async deliver(peer: string, text: string): Promise<void> {
    const { t } = this.deps;
    const owner = this.owner();
    if (!owner) throw new Error(t("channels.zalo.notifyNeedsOwner"));
    if (peer !== "home" && peer !== `zalo:${owner.id}`)
      throw new Error(`Unknown delivery target: ${peer}`);
    const channel = this.onlineChannel;
    if (!channel) throw new Error(t("channels.zalo.notifyNeedsOnline"));
    try {
      await channel.notify(owner.id, text);
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
      if (input.enabled && token === undefined && (await this.readToken()) === null)
        throw new Error(t("channels.zalo.tokenRequired"));

      if (token !== undefined) {
        await this.writeToken(token);
        this.botName = botName;
      }
      settings.update((draft) => {
        draft.channels.zalo = {
          ...draft.channels.zalo,
          enabled: input.enabled,
          agentId: draft.agents.some((agent) => agent.id === input.agentId) ? input.agentId : null,
          workspaceId: draft.workspaces.some((workspace) => workspace.id === input.workspaceId)
            ? input.workspaceId
            : DEFAULT_WORKSPACE_ID,
        };
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

  forget(): Promise<ZaloStatus> {
    return this.serial(async () => {
      await this.stopChannel();
      await this.deleteToken();
      this.deps.settings.update((draft) => {
        const zalo = draft.channels.zalo;
        zalo.enabled = false;
        zalo.ownerId = null;
        zalo.ownerName = null;
      });
      this.botName = null;
      this.deps.changed();
      return this.status();
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
    const { ownerId, ownerName } = this.deps.settings.get().channels.zalo;
    return ownerId === null ? null : { id: ownerId, name: ownerName ?? ownerId };
  }

  private paired(owner: ZaloOwner): void {
    this.deps.settings.update((draft) => {
      draft.channels.zalo.ownerId = owner.id;
      draft.channels.zalo.ownerName = owner.name;
    });
    this.guard.close();
    this.deps.changed();
  }
}
