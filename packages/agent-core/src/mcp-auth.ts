import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { McpExtensionOptions } from "@earendil-works/pi-coding-agent";
import { t } from "./i18n.ts";
import { MCP_AUTH_KEY_PREFIX, type VaultCredentialStore } from "./credentials.ts";

/** Vault id of the whole MCP OAuth state. */
const VAULT_ID = `${MCP_AUTH_KEY_PREFIX}state`;
/** File Pi's MCP extension writes in plain text when it is not given a store. */
const LEGACY_FILE = "mcp-auth.json";

type McpAuthStates = Record<string, unknown>;
type McpAuthCredentials = NonNullable<McpExtensionOptions["credentials"]>;

/** Pi's state key of a server: by name and URL, so servers that share a URL keep separate accounts. */
function storeKeys(name: string, serverUrl: string): { key: string; legacyKey: string } {
  const legacyKey = String(new URL(serverUrl));
  return { key: `mcp__${name.replace(/-/g, "_")}|${legacyKey}`, legacyKey };
}

function isStates(value: unknown): value is McpAuthStates {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * MCP OAuth state (client registration, access and refresh tokens, PKCE verifiers) of every
 * server, kept in the encrypted vault instead of Pi's plain-text `mcp-auth.json`.
 *
 * Pi's MCP extension accepts a credential store through `createMcpExtension({ credentials })` and
 * uses three members of it: `forServer(name, url)` (load, save, refresh lock), `tokens(name, url)`
 * and `remove(name, url)`. The last two are synchronous, so the state lives in memory and every
 * change is written to the vault right away, one write at a time. Only this process uses the
 * state, so the file lock Pi uses between processes is replaced by a lock per server.
 */
export class VaultMcpAuthStore {
  private writes: Promise<void> = Promise.resolve();
  private readonly locks = new Map<string, Promise<unknown>>();

  private constructor(
    private readonly vault: VaultCredentialStore,
    private states: McpAuthStates,
  ) {}

  /**
   * Opens the store: loads the vault entry and moves an existing plain-text `mcp-auth.json` into
   * it. Resolves with null when the OS cannot encrypt (the caller then keeps Pi's file store) or
   * when the vault cannot be read or written.
   */
  static async open(
    vault: VaultCredentialStore,
    agentDir: string,
  ): Promise<VaultMcpAuthStore | null> {
    try {
      if (!(await vault.secureStorageAvailable())) return null;
      // A failed read must not look like "no sign-ins": the next save would overwrite them all.
      const stored = await vault.readStrict(VAULT_ID);
      const parsed: unknown =
        stored?.type === "api_key" && stored.key ? JSON.parse(stored.key) : {};
      const store = new VaultMcpAuthStore(vault, isStates(parsed) ? parsed : {});
      await store.migrate(join(agentDir, LEGACY_FILE));
      return store;
    } catch (error) {
      console.error("MCP sign-ins could not be moved to secure storage:", error);
      return null;
    }
  }

  /** The store in the shape Pi's extension expects (`McpOAuthCredentialStore`). */
  asPiStore(): McpAuthCredentials {
    return this as unknown as McpAuthCredentials;
  }

  forServer(name: string, serverUrl: string) {
    const { key, legacyKey } = storeKeys(name, serverUrl);
    return {
      // The first server to load legacy state (keyed by URL alone) takes it over.
      load: () => {
        if (this.states[key] === undefined && this.states[legacyKey] !== undefined) {
          this.states[key] = this.states[legacyKey];
          delete this.states[legacyKey];
          void this.persist().catch(() => undefined);
        }
        const state = this.states[key];
        return state === undefined ? undefined : structuredClone(state);
      },
      save: (state: unknown) => {
        this.states[key] = structuredClone(state);
        return this.persist();
      },
      withRefreshLock: <T>(fn: () => Promise<T>): Promise<T> => this.withLock(key, fn),
    };
  }

  tokens(name: string, serverUrl: string): unknown {
    const { key, legacyKey } = storeKeys(name, serverUrl);
    const state = (this.states[key] ?? this.states[legacyKey]) as { tokens?: unknown } | undefined;
    return state?.tokens;
  }

  remove(name: string, serverUrl: string): boolean {
    const { key, legacyKey } = storeKeys(name, serverUrl);
    // Both keys go: a leftover URL-only entry would be adopted again by the next `forServer`.
    const had = key in this.states || legacyKey in this.states;
    if (!had) return false;
    delete this.states[key];
    delete this.states[legacyKey];
    // Pi's sign-out is synchronous; the caller awaits `flush()` before reporting success.
    void this.persist().catch(() => undefined);
    return true;
  }

  /** Resolves once every write so far reached the vault; rejects if the last one failed. */
  async flush(): Promise<void> {
    await this.persist();
  }

  private async migrate(file: string): Promise<void> {
    if (!existsSync(file)) return;
    let legacy: unknown;
    try {
      legacy = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      // Unreadable (or empty): nothing to keep, and the plain-text file must not stay behind.
      console.error("The old MCP sign-in file could not be read and was removed:", error);
      rmSync(file, { force: true });
      return;
    }
    if (isStates(legacy)) {
      // Entries already in the vault are newer than the file.
      this.states = { ...legacy, ...this.states };
      await this.persist();
    }
    rmSync(file, { force: true });
  }

  /** Writes the current state to the vault; writes never overlap and the last one wins. */
  private persist(): Promise<void> {
    const run = this.writes.then(() =>
      this.vault
        .modify(VAULT_ID, async () => ({ type: "api_key", key: JSON.stringify(this.states) }))
        .then(() => undefined),
    );
    this.writes = run.catch((error: unknown) => {
      console.error(t("mcp.authNotSaved"), error);
    });
    return run;
  }

  private withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.catch(() => undefined);
    this.locks.set(key, tail);
    void tail.then(() => {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    });
    return run;
  }
}
