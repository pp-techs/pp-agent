import {
  CHANNEL_ACCOUNT_ID_PATTERN,
  chatKeyPrefix,
  DEFAULT_CHANNEL_ACCOUNT_ID,
  type ChannelAccount,
} from "@workspace/shared";

export { chatKeyPrefix };
import { CHANNEL_KEY_PREFIX } from "../names.ts";
import type { ChannelService } from "../types.ts";

/** The chat apps that can have accounts. */
export type ChannelKind = "telegram" | "zalo";

/**
 * The account a chat key (`telegram:123`, `telegram:work:123`) or delivery target belongs to. The
 * key is the account's id and the chat id after it, and a chat id has no `:`, so the longest id
 * that prefixes the key wins (`telegram:work` before `telegram`).
 */
export function findChannel<C extends Pick<ChannelService, "id">>(
  channels: readonly C[],
  key: string,
): C | undefined {
  let found: C | undefined;
  for (const channel of channels)
    if (
      key.startsWith(`${channel.id}:`) &&
      !key.slice(channel.id.length + 1).includes(":") &&
      (!found || channel.id.length > found.id.length)
    )
      found = channel;
  return found;
}

/** Vault id of an account's token; the first account keeps the id it had before accounts. */
export function accountTokenKey(kind: ChannelKind, accountId: string): string {
  return `${CHANNEL_KEY_PREFIX}${chatKeyPrefix(kind, accountId)}`;
}

/** File name of an account's saved poll offset. */
export function offsetFileName(kind: ChannelKind, accountId: string): string {
  return accountId === DEFAULT_CHANNEL_ACCOUNT_ID
    ? `${kind}-offset.json`
    : `${kind}-offset-${accountId}.json`;
}

/** Name shown for an account's chat app: "Telegram", or "Telegram (Work)" with a label. */
export function accountDisplayName(appName: string, label: string): string {
  return label ? `${appName} (${label})` : appName;
}

/**
 * Reads the saved accounts of one chat app. A list is read account by account (bad ids and
 * repeated ids are dropped); the single object written before accounts existed becomes the
 * account `default`.
 */
export function readAccounts<S extends object>(
  raw: unknown,
  readOne: (value: unknown) => S,
): Array<S & ChannelAccount> {
  if (Array.isArray(raw)) {
    const seen = new Set<string>();
    const accounts: Array<S & ChannelAccount> = [];
    for (const item of raw) {
      if (typeof item !== "object" || item === null) continue;
      const { id, label } = item as Record<string, unknown>;
      if (typeof id !== "string" || !CHANNEL_ACCOUNT_ID_PATTERN.test(id) || seen.has(id)) continue;
      seen.add(id);
      accounts.push({
        ...readOne(item),
        id,
        label: typeof label === "string" ? label.trim().slice(0, 60) : "",
      });
    }
    return accounts;
  }
  if (typeof raw === "object" && raw !== null)
    return [{ ...readOne(raw), id: DEFAULT_CHANNEL_ACCOUNT_ID, label: "" }];
  return [];
}

/**
 * An id for a new account: `default` while the app has no accounts, else the label as a slug (or
 * `bot`), made unique with a number.
 */
export function newAccountId(existing: readonly string[], label: string): string {
  if (existing.length === 0) return DEFAULT_CHANNEL_ACCOUNT_ID;
  const slug =
    label
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "bot";
  const taken = new Set(existing);
  const base = slug === DEFAULT_CHANNEL_ACCOUNT_ID ? "bot" : slug;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Replaces the account with this id in `list`, or appends it when there is none yet. */
export function upsertAccount<A extends ChannelAccount>(
  list: A[],
  id: string,
  next: (previous: A | undefined) => A,
): void {
  const index = list.findIndex((account) => account.id === id);
  if (index < 0) list.push(next(undefined));
  else list[index] = next(list[index]);
}

/** One account's bot, as the manager below drives it. */
export interface AccountService<Status, Input> extends ChannelService {
  readonly accountId: string;
  status(): Promise<Status>;
  /** Saves the account's settings (creating it when it is new) and applies them. */
  save(input: Input): Promise<Status>;
  startPairing(): Promise<Status>;
  /** Stops the bot and removes its token, saved state and settings. */
  forget(): Promise<void>;
  /** The saved bot token, or null; used to refuse one token on two accounts. */
  token(): Promise<string | null>;
}

export interface AccountInput {
  accountId?: string;
  label?: string;
  token?: string;
}

export interface ChannelAccountsDeps<Status, Input> {
  /** The saved accounts, read live from settings. */
  saved(): readonly ChannelAccount[];
  create(accountId: string): AccountService<Status, Input>;
  /** The sentence for a token another account already uses. */
  tokenInUse(): string;
  unknownAccount(id: string): string;
}

/**
 * Every account of one chat app: one service per saved account, each with its own bot, token and
 * owner. Adding, changing and removing accounts happen one at a time.
 */
export class ChannelAccounts<Status, Input extends AccountInput> {
  private readonly byId = new Map<string, AccountService<Status, Input>>();
  private lock: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: ChannelAccountsDeps<Status, Input>) {}

  /** The services of the saved accounts, in the order they were added. */
  services(): AccountService<Status, Input>[] {
    const saved = this.deps.saved();
    for (const { id } of saved) if (!this.byId.has(id)) this.byId.set(id, this.deps.create(id));
    return saved.flatMap(({ id }) => this.byId.get(id) ?? []);
  }

  list(): Promise<Status[]> {
    return Promise.all(this.services().map((service) => service.status()));
  }

  /** Changes the account `input.accountId`, or adds a new one when it is omitted. */
  save(input: Input): Promise<Status> {
    return this.serial(async () => {
      const token = input.token?.trim();
      if (input.accountId !== undefined) {
        const service = this.find(input.accountId);
        if (token) await this.refuseUsedToken(token, service.accountId);
        return service.save(input);
      }
      if (token) await this.refuseUsedToken(token, null);
      const id = newAccountId(
        this.deps.saved().map((account) => account.id),
        input.label ?? "",
      );
      const service = this.deps.create(id);
      this.byId.set(id, service);
      try {
        return await service.save({ ...input, accountId: id });
      } catch (error) {
        // Nothing was saved for an account that failed to start.
        if (!this.deps.saved().some((account) => account.id === id)) this.byId.delete(id);
        throw error;
      }
    });
  }

  startPairing(accountId: string): Promise<Status> {
    return this.serial(() => this.find(accountId).startPairing());
  }

  /** Removes one account for good and returns the ones left. */
  forget(accountId: string): Promise<Status[]> {
    return this.serial(async () => {
      await this.find(accountId).forget();
      this.byId.delete(accountId);
      return this.list();
    });
  }

  private find(accountId: string): AccountService<Status, Input> {
    const service = this.services().find((candidate) => candidate.accountId === accountId);
    if (!service) throw new Error(this.deps.unknownAccount(accountId));
    return service;
  }

  /** The same bot polled by two accounts would fight over its updates. */
  private async refuseUsedToken(token: string, own: string | null): Promise<void> {
    for (const service of this.services()) {
      if (service.accountId === own) continue;
      if ((await service.token()) === token) throw new Error(this.deps.tokenInUse());
    }
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.lock.then(work);
    this.lock = next.catch(() => {});
    return next;
  }
}
