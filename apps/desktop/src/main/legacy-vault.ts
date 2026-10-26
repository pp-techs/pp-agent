import { existsSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StoredCredential } from "@workspace/shared";
import { app, safeStorage } from "electron";
import { translator } from "./i18n.ts";

/**
 * The credentials file earlier versions kept in the main process, encrypted with the OS keychain
 * (safeStorage). pp-agentd has its own vault now; this file is only read once, to move what it
 * holds across, and then deleted. File shape:
 * `{ [providerId]: base64(encrypt(JSON.stringify(StoredCredential))) }`.
 */
const VAULT_FILE = join(app.getPath("userData"), "credentials.json");

type VaultFile = Record<string, string>;

/** Every operation runs after the previous one, so a read never sees a half-applied write. */
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

async function readVault(): Promise<VaultFile> {
  let text: string;
  try {
    text = await readFile(VAULT_FILE, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const vault: VaultFile = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") vault[key] = value;
  }
  return vault;
}

async function writeVault(vault: VaultFile): Promise<void> {
  // Write a sibling file and rename it so a crash never leaves a truncated vault behind.
  const temp = `${VAULT_FILE}.tmp`;
  await writeFile(temp, JSON.stringify(vault, null, 2), { mode: 0o600 });
  await rename(temp, VAULT_FILE);
}

async function encrypt(credential: StoredCredential): Promise<string> {
  if (!(await safeStorage.isAsyncEncryptionAvailable()))
    throw new Error(translator()("app.secureStorageUnavailable"));
  return (await safeStorage.encryptStringAsync(JSON.stringify(credential))).toString("base64");
}

async function decrypt(entry: string): Promise<StoredCredential> {
  const { result } = await safeStorage.decryptStringAsync(Buffer.from(entry, "base64"));
  return JSON.parse(result) as StoredCredential;
}

/** Stores one credential; used by the legacy settings migration. */
export function storeCredential(providerId: string, credential: StoredCredential): Promise<void> {
  return serialize(async () => {
    const vault = await readVault();
    await writeVault({ ...vault, [providerId]: await encrypt(credential) });
  });
}

export interface LegacyCredentials {
  /** Entries that decrypted. */
  entries: Record<string, StoredCredential>;
  /** Ids of entries the keychain could not decrypt; they are left out. */
  failed: string[];
}

/** Every credential the old vault holds; entries that cannot be decrypted are reported, not thrown. */
export function readAllLegacy(): Promise<LegacyCredentials> {
  return serialize(async () => {
    const vault = await readVault();
    const entries: Record<string, StoredCredential> = {};
    const failed: string[] = [];
    for (const [id, entry] of Object.entries(vault)) {
      try {
        entries[id] = await decrypt(entry);
      } catch (error) {
        console.error(`The saved sign-in for ${id} could not be decrypted:`, error);
        failed.push(id);
      }
    }
    return { entries, failed };
  });
}

/**
 * Moves the old vault into the daemon through `importEntries`, then deletes it. Does nothing when
 * there is no old vault. If nothing in a non-empty vault can be decrypted the file stays, so a
 * later run (with the keychain unlocked) can still recover it.
 */
export async function migrateLegacyVault(
  importEntries: (entries: Record<string, StoredCredential>) => Promise<void>,
): Promise<void> {
  if (!existsSync(VAULT_FILE)) return;
  const { entries, failed } = await readAllLegacy();
  if (Object.keys(entries).length === 0 && failed.length > 0) return;
  if (Object.keys(entries).length > 0) await importEntries(entries);
  await rm(VAULT_FILE, { force: true });
}
