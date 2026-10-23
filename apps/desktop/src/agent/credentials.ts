import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import type { MainToAgentMessage, StoredCredential, VaultRequest } from "@workspace/shared";
import { t } from "./i18n.ts";
import { send } from "./ipc.ts";
import { WEB_KEY_PREFIX } from "./web/names.ts";

type VaultResult = Extract<MainToAgentMessage, { kind: "vault_result" }>;

/**
 * Pi's credential store, backed by the encrypted vault in the main process. Every provider
 * credential (built-in providers and gateways) lives there; this process only keeps a cache. Only
 * this process writes the vault, so the cache stays accurate once an entry has been read.
 */
export class VaultCredentialStore implements CredentialStore {
  private nextId = 0;
  private readonly pending = new Map<number, PromiseWithResolvers<unknown>>();
  /** Provider id → credential, or null when the vault has none. */
  private readonly cache = new Map<string, Credential | null>();
  private providerIds: Promise<Set<string>> | null = null;
  /** Tail of the operation chain per provider, so writes to one provider never interleave. */
  private readonly locks = new Map<string, Promise<unknown>>();

  /** Feeds a `vault_result` message from the main process. */
  resolve(message: VaultResult): void {
    const request = this.pending.get(message.id);
    if (!request) return;
    this.pending.delete(message.id);
    if (message.ok) request.resolve(message.data);
    else request.reject(new Error(t("app.secureStorage", { error: message.error })));
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return (await this.load(providerId)) ?? undefined;
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const ids = await this.ids();
    const infos: CredentialInfo[] = [];
    for (const providerId of ids) {
      // Search keys share the vault but are not providers.
      if (providerId.startsWith(WEB_KEY_PREFIX)) continue;
      const credential = await this.load(providerId);
      if (credential) infos.push({ providerId, type: credential.type });
    }
    return infos;
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.withLock(providerId, async () => {
      const current = (await this.load(providerId)) ?? undefined;
      const next = await fn(current);
      if (next === undefined) return current;
      await this.request({
        op: "write",
        providerId,
        credential: next as StoredCredential,
      });
      this.cache.set(providerId, next);
      (await this.ids()).add(providerId);
      return next;
    });
  }

  delete(providerId: string): Promise<void> {
    return this.withLock(providerId, async () => {
      await this.request({ op: "delete", providerId });
      this.cache.set(providerId, null);
      (await this.ids()).delete(providerId);
    });
  }

  private async load(providerId: string): Promise<Credential | null> {
    const cached = this.cache.get(providerId);
    if (cached !== undefined) return cached;
    const ids = await this.ids();
    if (!ids.has(providerId)) return null;
    let credential: Credential | null;
    try {
      credential = (await this.request({ op: "read", providerId })) as Credential | null;
    } catch (error) {
      // An entry the keychain can no longer decrypt counts as missing; signing in again replaces it.
      console.error(`The saved sign-in for ${providerId} could not be read:`, error);
      credential = null;
    }
    // A write may have landed while the read was in flight; it wins.
    if (!this.cache.has(providerId)) this.cache.set(providerId, credential);
    return this.cache.get(providerId) ?? null;
  }

  private ids(): Promise<Set<string>> {
    if (!this.providerIds) {
      const load = this.request({ op: "list" }).then((ids) => new Set(ids as string[]));
      // A failed load is retried on the next call.
      load.catch(() => {
        if (this.providerIds === load) this.providerIds = null;
      });
      this.providerIds = load;
    }
    return this.providerIds;
  }

  private withLock<T>(providerId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(providerId) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.catch(() => undefined);
    this.locks.set(providerId, tail);
    void tail.then(() => {
      if (this.locks.get(providerId) === tail) this.locks.delete(providerId);
    });
    return run;
  }

  private request(request: VaultRequest): Promise<unknown> {
    this.nextId += 1;
    const id = this.nextId;
    const resolvers = Promise.withResolvers<unknown>();
    this.pending.set(id, resolvers);
    send({ kind: "vault", id, request });
    return resolvers.promise;
  }
}
