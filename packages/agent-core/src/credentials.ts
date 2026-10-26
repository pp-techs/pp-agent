import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import type { StoredCredential } from "@workspace/shared";
import { CHANNEL_KEY_PREFIX } from "./channels/names.ts";
import type { VaultBackend } from "./host-io.ts";
import { t } from "./i18n.ts";
import { errorMessage } from "./ipc.ts";
import { WEB_KEY_PREFIX } from "./web/names.ts";

/** Vault id prefix of the MCP OAuth state; Pi's provider list skips it like search keys. */
export const MCP_AUTH_KEY_PREFIX = "mcp-auth:";

/**
 * Pi's credential store, backed by the daemon's vault. Every provider credential (built-in
 * providers and gateways) lives there; this class only keeps a cache. Only the host writes the
 * vault, so the cache stays accurate once an entry has been read.
 */
export class VaultCredentialStore implements CredentialStore {
  /** Provider id → credential, or null when the vault has none. */
  private readonly cache = new Map<string, Credential | null>();
  private providerIds: Promise<Set<string>> | null = null;
  /** Tail of the operation chain per provider, so writes to one provider never interleave. */
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly backend: VaultBackend) {}

  async read(providerId: string): Promise<Credential | undefined> {
    return (await this.load(providerId)) ?? undefined;
  }

  /**
   * Like `read`, but an entry that exists and cannot be read throws instead of counting as missing,
   * for callers that would otherwise write an empty replacement over it.
   */
  async readStrict(providerId: string): Promise<Credential | undefined> {
    const cached = this.cache.get(providerId);
    if (cached !== undefined) return cached ?? undefined;
    if (!(await this.ids()).has(providerId)) return undefined;
    const credential = (await this.guard(this.backend.read(providerId))) as Credential | null;
    // A write may have landed while the read was in flight; it wins.
    if (!this.cache.has(providerId)) this.cache.set(providerId, credential);
    return this.cache.get(providerId) ?? undefined;
  }

  /** Whether the vault really protects what it holds. */
  async secureStorageAvailable(): Promise<boolean> {
    return this.guard(this.backend.available());
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const ids = await this.ids();
    const infos: CredentialInfo[] = [];
    for (const providerId of ids) {
      // Search keys share the vault but are not providers.
      if (
        providerId.startsWith(WEB_KEY_PREFIX) ||
        providerId.startsWith(MCP_AUTH_KEY_PREFIX) ||
        providerId.startsWith(CHANNEL_KEY_PREFIX)
      )
        continue;
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
      await this.guard(this.backend.write(providerId, next as StoredCredential));
      this.cache.set(providerId, next);
      (await this.ids()).add(providerId);
      return next;
    });
  }

  delete(providerId: string): Promise<void> {
    return this.withLock(providerId, async () => {
      await this.guard(this.backend.delete(providerId));
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
      credential = (await this.guard(this.backend.read(providerId))) as Credential | null;
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
      const load = this.guard(this.backend.list()).then((ids) => new Set(ids));
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

  /** Backend failures reach the person as "Secure storage: …". */
  private async guard<T>(operation: Promise<T>): Promise<T> {
    try {
      return await operation;
    } catch (error) {
      throw new Error(t("app.secureStorage", { error: errorMessage(error) }));
    }
  }
}
