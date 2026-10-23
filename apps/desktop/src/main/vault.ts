import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StoredCredential, VaultRequest } from "@workspace/shared";
import { app, safeStorage } from "electron";
import { translator } from "./i18n.ts";

/**
 * Credentials of every model provider, encrypted with the OS keychain (safeStorage). Only the main
 * process can use safeStorage, so the agent process reaches this file through `vault` messages.
 * File shape: `{ [providerId]: base64(encrypt(JSON.stringify(StoredCredential))) }`.
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

async function read(providerId: string): Promise<StoredCredential | null> {
  const vault = await readVault();
  const entry = vault[providerId];
  if (!entry) return null;
  const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(
    Buffer.from(entry, "base64"),
  );
  const credential = JSON.parse(result) as StoredCredential;
  // The OS rotated the key; store the entry under the new one so it keeps decrypting.
  if (shouldReEncrypt) await writeVault({ ...vault, [providerId]: await encrypt(credential) });
  return credential;
}

async function write(providerId: string, credential: StoredCredential): Promise<void> {
  const vault = await readVault();
  await writeVault({ ...vault, [providerId]: await encrypt(credential) });
}

async function remove(providerId: string): Promise<void> {
  const vault = await readVault();
  if (!(providerId in vault)) return;
  delete vault[providerId];
  await writeVault(vault);
}

/** Answers a `vault` message from the agent process. */
export function handleVaultRequest(request: VaultRequest): Promise<unknown> {
  return serialize(async () => {
    switch (request.op) {
      case "read":
        return read(request.providerId);
      case "list":
        return Object.keys(await readVault());
      case "write":
        return write(request.providerId, request.credential);
      case "delete":
        return remove(request.providerId);
    }
  });
}

/** Stores one credential; used by the legacy settings migration. */
export function storeCredential(providerId: string, credential: StoredCredential): Promise<void> {
  return serialize(() => write(providerId, credential));
}
