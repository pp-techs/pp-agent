import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VaultBackend } from "@workspace/agent-core";
import type { StoredCredential } from "@workspace/shared";

/**
 * Credentials of every provider, search key and MCP sign-in, kept in `<home>/vault.json`.
 * File shape: `{ version: 1, entries: { [id]: base64(iv(12) | tag(16) | ciphertext) } }`, each
 * entry AES-256-GCM encrypted with the id as additional authenticated data, so an entry copied
 * under another id fails to decrypt. One random master key encrypts them all.
 */
const VAULT_FILE = "vault.json";
const KEY_FILE = "vault.key";
const KEYRING_SERVICE = "PP Agent";
const KEYRING_ACCOUNT = "vault-master-key";
const MASTER_KEY_ENV = "PP_AGENT_MASTER_KEY";
const VERSION = 1;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Where the master key came from, best protected first. */
export type KeySource = "env" | "keyring" | "file";

/** The slice of an `@napi-rs/keyring` entry the vault uses. */
export interface KeyringEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
}

/** The slice of the `@napi-rs/keyring` module the vault uses. */
export interface KeyringModule {
  Entry: new (service: string, account: string) => KeyringEntry;
}

export interface VaultOptions {
  /** Environment to read `PP_AGENT_MASTER_KEY` from; defaults to `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Loads the OS keyring binding; defaults to a dynamic import of `@napi-rs/keyring`. */
  loadKeyring?: () => Promise<KeyringModule>;
}

export interface DaemonVault extends VaultBackend {
  readonly keySource: KeySource;
}

const loadNativeKeyring = (): Promise<KeyringModule> => import("@napi-rs/keyring");

/** Parses a 32-byte key written as hex or base64; null when it is neither. */
function parseKey(text: string): Buffer | null {
  const value = text.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
  const key = Buffer.from(value, "base64");
  return key.length === KEY_BYTES ? key : null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Reads the key from the OS keyring, creating it on first use; null when the keyring is unusable. */
async function keyringKey(load: () => Promise<KeyringModule>): Promise<Buffer | null> {
  try {
    const { Entry } = await load();
    const entry = new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT);
    const stored = entry.getPassword();
    if (stored !== null) {
      const key = parseKey(stored);
      if (!key) throw new Error("the stored master key is not a 32-byte key");
      return key;
    }
    const key = randomBytes(KEY_BYTES);
    entry.setPassword(key.toString("base64"));
    // A real read-back proves the keyring keeps what it was given, not just that the call returned.
    const readBack = entry.getPassword();
    if (readBack === null || !key.equals(parseKey(readBack) ?? Buffer.alloc(0))) {
      throw new Error("the key did not read back from the keyring");
    }
    return key;
  } catch (error) {
    console.warn(`The OS keyring cannot hold the vault key, using a key file: ${message(error)}`);
    return null;
  }
}

/** Reads `<home>/vault.key`, creating it (mode 0600) on first use. */
async function fileKey(home: string): Promise<Buffer> {
  const path = join(home, KEY_FILE);
  const read = async (): Promise<Buffer | null> => {
    try {
      const key = parseKey(await readFile(path, "utf8"));
      if (!key) throw new Error(`${path} does not hold a 32-byte key`);
      return key;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  };
  const existing = await read();
  if (existing) return existing;
  const key = randomBytes(KEY_BYTES);
  try {
    await writeFile(path, `${key.toString("hex")}\n`, { mode: 0o600, flag: "wx" });
    return key;
  } catch (error) {
    // Another process created it first: use its key.
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const created = await read();
    if (!created) throw error;
    return created;
  }
}

async function resolveMasterKey(
  home: string,
  options: VaultOptions,
): Promise<{ key: Buffer; source: KeySource }> {
  const fromEnv = (options.env ?? process.env)[MASTER_KEY_ENV];
  if (fromEnv !== undefined && fromEnv.trim() !== "") {
    const key = parseKey(fromEnv);
    if (!key) throw new Error(`${MASTER_KEY_ENV} must be 32 bytes written as hex or base64.`);
    return { key, source: "env" };
  }
  const fromKeyring = await keyringKey(options.loadKeyring ?? loadNativeKeyring);
  if (fromKeyring) return { key: fromKeyring, source: "keyring" };
  return { key: await fileKey(home), source: "file" };
}

function encrypt(key: Buffer, id: string, credential: StoredCredential): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(id, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credential), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

function decrypt(key: Buffer, id: string, entry: string): StoredCredential {
  try {
    const raw = Buffer.from(entry, "base64");
    if (raw.length < IV_BYTES + TAG_BYTES) throw new Error("the entry is too short");
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(id, "utf8"));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const plain = Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plain) as StoredCredential;
  } catch (error) {
    throw new Error(`The saved credential "${id}" could not be decrypted: ${message(error)}`, {
      cause: error,
    });
  }
}

/** Entries by id; a Map so an id such as `__proto__` is just another key. */
type Entries = Map<string, string>;

async function readEntries(path: string): Promise<Entries> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw new Error(`The vault ${path} cannot be read: ${message(error)}`, { cause: error });
  }
  if (text.trim() === "") return new Map();
  const invalid = (reason: string): Error =>
    new Error(`The vault ${path} is not valid (${reason}); it was left untouched.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`The vault ${path} is not valid JSON; it was left untouched.`, {
      cause: error,
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw invalid("not an object");
  const { version, entries } = parsed as { version?: unknown; entries?: unknown };
  if (version !== VERSION) throw invalid(`unsupported version ${String(version)}`);
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    throw invalid("entries is not an object");
  }
  const result: Entries = new Map();
  for (const [id, value] of Object.entries(entries)) {
    if (typeof value !== "string") throw invalid(`entry "${id}" is not a string`);
    result.set(id, value);
  }
  return result;
}

async function writeEntries(path: string, entries: Entries): Promise<void> {
  // Write a sibling file and rename it so a crash never leaves a truncated vault behind.
  const temp = `${path}.tmp`;
  const body = JSON.stringify({ version: VERSION, entries: Object.fromEntries(entries) }, null, 2);
  try {
    await writeFile(temp, body, { mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Opens the credential vault under `home`. The master key comes from `PP_AGENT_MASTER_KEY`, else
 * the OS keyring, else `<home>/vault.key`. `available()` is true for every source: the file key
 * is weaker, but the vault still works, and MCP sign-ins are refused when it reports false.
 */
export async function createVaultBackend(
  home: string,
  options: VaultOptions = {},
): Promise<DaemonVault> {
  await mkdir(home, { recursive: true });
  const { key, source } = await resolveMasterKey(home, options);
  const path = join(home, VAULT_FILE);

  /** Every operation runs after the previous one, so a read never sees a half-applied write. */
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    keySource: source,
    read: (id) =>
      serialize(async () => {
        const entry = (await readEntries(path)).get(id);
        return entry === undefined ? null : decrypt(key, id, entry);
      }),
    list: () => serialize(async () => [...(await readEntries(path)).keys()]),
    write: (id, credential) =>
      serialize(async () => {
        const entries = await readEntries(path);
        entries.set(id, encrypt(key, id, credential));
        await writeEntries(path, entries);
      }),
    delete: (id) =>
      serialize(async () => {
        const entries = await readEntries(path);
        if (entries.delete(id)) await writeEntries(path, entries);
      }),
    available: async () => true,
  };
}
