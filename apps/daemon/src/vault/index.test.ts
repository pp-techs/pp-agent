import { randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StoredCredential } from "@workspace/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createVaultBackend, type KeyringEntry, type KeyringModule } from "./index.ts";

const credential = { type: "api_key", key: "sk-secret" } as unknown as StoredCredential;
const other = { type: "api_key", key: "sk-other" } as unknown as StoredCredential;

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "pp-vault-"));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(home, { recursive: true, force: true });
});

/** An in-memory keyring; `fail` makes every entry operation throw. */
function fakeKeyring(options: { fail?: boolean; stored?: string } = {}) {
  const state = { value: options.stored ?? null, sets: 0 };
  const module: KeyringModule = {
    Entry: class implements KeyringEntry {
      getPassword(): string | null {
        if (options.fail) throw new Error("no keyring");
        return state.value;
      }
      setPassword(password: string): void {
        if (options.fail) throw new Error("no keyring");
        state.value = password;
        state.sets += 1;
      }
    },
  };
  return { state, load: async () => module };
}

const noKeyring = async (): Promise<KeyringModule> => {
  throw new Error("native binding missing");
};

async function readVaultFile(): Promise<{ version: number; entries: Record<string, string> }> {
  return JSON.parse(await readFile(join(home, "vault.json"), "utf8"));
}

describe("vault", () => {
  it("round-trips, lists and deletes", async () => {
    const keyring = fakeKeyring();
    const vault = await createVaultBackend(home, { env: {}, loadKeyring: keyring.load });
    expect(await vault.read("a")).toBeNull();
    await vault.write("a", credential);
    await vault.write("b", other);
    expect(await vault.read("a")).toEqual(credential);
    expect(await vault.list()).toEqual(["a", "b"]);
    await vault.write("a", other);
    expect(await vault.read("a")).toEqual(other);
    await vault.delete("a");
    await vault.delete("missing");
    expect(await vault.read("a")).toBeNull();
    expect(await vault.list()).toEqual(["b"]);
  });

  it("does not store the secret in clear text", async () => {
    const vault = await createVaultBackend(home, { env: {}, loadKeyring: fakeKeyring().load });
    await vault.write("a", credential);
    expect(await readFile(join(home, "vault.json"), "utf8")).not.toContain("sk-secret");
    expect((await readVaultFile()).version).toBe(1);
  });

  it("treats __proto__ as an ordinary id", async () => {
    const vault = await createVaultBackend(home, { env: {}, loadKeyring: fakeKeyring().load });
    await vault.write("__proto__", credential);
    expect(await vault.list()).toEqual(["__proto__"]);
    expect(await vault.read("__proto__")).toEqual(credential);
  });

  it("persists across instances that share the key", async () => {
    const keyring = fakeKeyring();
    const first = await createVaultBackend(home, { env: {}, loadKeyring: keyring.load });
    await first.write("a", credential);
    const second = await createVaultBackend(home, { env: {}, loadKeyring: keyring.load });
    expect(second.keySource).toBe("keyring");
    expect(await second.read("a")).toEqual(credential);
    expect(keyring.state.sets).toBe(1);
  });

  it("detects a modified ciphertext", async () => {
    const vault = await createVaultBackend(home, { env: {}, loadKeyring: fakeKeyring().load });
    await vault.write("a", credential);
    const file = await readVaultFile();
    const raw = Buffer.from(file.entries.a!, "base64");
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 1;
    file.entries.a = raw.toString("base64");
    await writeFile(join(home, "vault.json"), JSON.stringify(file));
    await expect(vault.read("a")).rejects.toThrow(/could not be decrypted/);
  });

  it("detects an entry swapped to another id", async () => {
    const vault = await createVaultBackend(home, { env: {}, loadKeyring: fakeKeyring().load });
    await vault.write("a", credential);
    await vault.write("b", other);
    const file = await readVaultFile();
    file.entries.b = file.entries.a!;
    await writeFile(join(home, "vault.json"), JSON.stringify(file));
    await expect(vault.read("b")).rejects.toThrow(/"b" could not be decrypted/);
    expect(await vault.read("a")).toEqual(credential);
  });

  it("rejects a changed key before any credential can be overwritten", async () => {
    const first = await createVaultBackend(home, { env: {}, loadKeyring: fakeKeyring().load });
    await first.write("a", credential);
    const original = await readFile(join(home, "vault.json"), "utf8");
    await expect(
      createVaultBackend(home, { env: { PP_AGENT_MASTER_KEY: "b".repeat(64) } }),
    ).rejects.toThrow(/does not match/);
    expect(await readFile(join(home, "vault.json"), "utf8")).toBe(original);
    expect(await first.read("a")).toEqual(credential);
  });

  it("keeps a file key when the keyring becomes available", async () => {
    const first = await createVaultBackend(home, { env: {}, loadKeyring: noKeyring });
    await first.write("a", credential);
    const keyring = fakeKeyring();
    const second = await createVaultBackend(home, { env: {}, loadKeyring: keyring.load });
    expect(second.keySource).toBe("file");
    expect(keyring.state.sets).toBe(0);
    expect(await second.read("a")).toEqual(credential);
  });

  it.each([noKeyring, fakeKeyring().load])(
    "never creates a key for an existing vault when its original key is missing",
    async (loadKeyring) => {
      const first = await createVaultBackend(home, { env: {}, loadKeyring: fakeKeyring().load });
      await first.write("a", credential);
      await expect(createVaultBackend(home, { env: {}, loadKeyring })).rejects.toThrow(
        /master key is unavailable/,
      );
      await expect(stat(join(home, "vault.key"))).rejects.toThrow();
    },
  );

  it("validates legacy entries before storing a key check", async () => {
    const keyring = fakeKeyring();
    const first = await createVaultBackend(home, { env: {}, loadKeyring: keyring.load });
    await first.write("a", credential);
    const file = await readVaultFile();
    await writeFile(
      join(home, "vault.json"),
      JSON.stringify({ version: 1, entries: file.entries }),
    );
    await expect(
      createVaultBackend(home, { env: { PP_AGENT_MASTER_KEY: "b".repeat(64) } }),
    ).rejects.toThrow(/could not be decrypted/);
    const second = await createVaultBackend(home, { env: {}, loadKeyring: keyring.load });
    expect(await second.read("a")).toEqual(credential);
    expect(JSON.parse(await readFile(join(home, "vault.json"), "utf8")).keyCheck).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it("prefers the env key over the keyring, as hex or base64", async () => {
    const key = randomBytes(32);
    const keyring = fakeKeyring();
    for (const text of [key.toString("hex"), key.toString("base64")]) {
      const vault = await createVaultBackend(home, {
        env: { PP_AGENT_MASTER_KEY: text },
        loadKeyring: keyring.load,
      });
      expect(vault.keySource).toBe("env");
      await vault.write("a", credential);
      expect(await vault.read("a")).toEqual(credential);
    }
    expect(keyring.state.sets).toBe(0);
    await expect(stat(join(home, "vault.key"))).rejects.toThrow();
  });

  it("rejects an env key that is not 32 bytes", async () => {
    await expect(
      createVaultBackend(home, {
        env: { PP_AGENT_MASTER_KEY: "too-short" },
        loadKeyring: fakeKeyring().load,
      }),
    ).rejects.toThrow(/PP_AGENT_MASTER_KEY/);
  });

  it("falls back to a key file when the keyring fails", async () => {
    for (const load of [fakeKeyring({ fail: true }).load, noKeyring]) {
      const vault = await createVaultBackend(home, { env: {}, loadKeyring: load });
      expect(vault.keySource).toBe("file");
      await vault.write("a", credential);
      const again = await createVaultBackend(home, { env: {}, loadKeyring: load });
      expect(await again.read("a")).toEqual(credential);
    }
    expect((await readFile(join(home, "vault.key"), "utf8")).trim()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("falls back when the keyring does not keep what it is given", async () => {
    const forgetful: KeyringModule = {
      Entry: class implements KeyringEntry {
        getPassword = () => null;
        setPassword = () => undefined;
      },
    };
    const vault = await createVaultBackend(home, { env: {}, loadKeyring: async () => forgetful });
    expect(vault.keySource).toBe("file");
  });

  it("falls back when the keyring holds an invalid key", async () => {
    const keyring = fakeKeyring({ stored: "garbage" });
    const vault = await createVaultBackend(home, { env: {}, loadKeyring: keyring.load });
    expect(vault.keySource).toBe("file");
  });

  it("refuses a key file that is not a key", async () => {
    await writeFile(join(home, "vault.key"), "nope");
    await expect(createVaultBackend(home, { env: {}, loadKeyring: noKeyring })).rejects.toThrow(
      /32-byte key/,
    );
  });

  it.skipIf(process.platform === "win32")("keeps the vault and key files private", async () => {
    const vault = await createVaultBackend(home, { env: {}, loadKeyring: noKeyring });
    await vault.write("a", credential);
    await vault.write("a", other);
    expect((await stat(join(home, "vault.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(home, "vault.key"))).mode & 0o777).toBe(0o600);
    await expect(stat(join(home, "vault.json.tmp"))).rejects.toThrow();
  });

  it("serializes concurrent writes", async () => {
    const vault = await createVaultBackend(home, { env: {}, loadKeyring: fakeKeyring().load });
    const ids = Array.from({ length: 25 }, (_, index) => `id-${index}`);
    await Promise.all(ids.map((id) => vault.write(id, credential)));
    expect([...(await vault.list())].sort()).toEqual([...ids].sort());
    await Promise.all(ids.slice(0, 10).map((id) => vault.delete(id)));
    expect(await vault.list()).toHaveLength(15);
  });

  it("creates the home folder", async () => {
    const nested = join(home, "a", "b");
    const vault = await createVaultBackend(nested, { env: {}, loadKeyring: noKeyring });
    await vault.write("a", credential);
    expect(await vault.read("a")).toEqual(credential);
  });

  it("reports available for every key source", async () => {
    const env = await createVaultBackend(home, {
      env: { PP_AGENT_MASTER_KEY: randomBytes(32).toString("hex") },
      loadKeyring: noKeyring,
    });
    const file = await createVaultBackend(home, { env: {}, loadKeyring: noKeyring });
    expect(await env.available()).toBe(true);
    expect(await file.available()).toBe(true);
  });
});

describe("vault file handling", () => {
  const open = () => createVaultBackend(home, { env: {}, loadKeyring: fakeKeyring().load });

  it("treats an empty vault.json as empty", async () => {
    await writeFile(join(home, "vault.json"), "  \n");
    const vault = await open();
    expect(await vault.list()).toEqual([]);
    await vault.write("a", credential);
    expect(await vault.read("a")).toEqual(credential);
  });

  it.each([
    ["not JSON", "{oops"],
    ["an array", "[]"],
    ["no version", JSON.stringify({ entries: {} })],
    ["a newer version", JSON.stringify({ version: 2, entries: {} })],
    ["bad entries", JSON.stringify({ version: 1, entries: [] })],
    ["a non-string entry", JSON.stringify({ version: 1, entries: { a: 1 } })],
  ])("throws on a malformed vault (%s) and leaves it untouched", async (_name, content) => {
    await writeFile(join(home, "vault.json"), content);
    await expect(open()).rejects.toThrow(/vault/);
    expect(await readFile(join(home, "vault.json"), "utf8")).toBe(content);
    await writeFile(join(home, "vault.json"), "");
    const vault = await open();
    await writeFile(join(home, "vault.json"), content);
    await expect(vault.read("a")).rejects.toThrow(/vault/);
    await expect(vault.list()).rejects.toThrow(/vault/);
    await expect(vault.write("a", credential)).rejects.toThrow(/vault/);
    await expect(vault.delete("a")).rejects.toThrow(/vault/);
    expect(await readFile(join(home, "vault.json"), "utf8")).toBe(content);
    // A failed operation does not wedge the queue.
    await writeFile(join(home, "vault.json"), "");
    expect(await vault.list()).toEqual([]);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "throws when vault.json is unreadable",
    async () => {
      const vault = await open();
      await vault.write("a", credential);
      await chmod(join(home, "vault.json"), 0o000);
      await expect(vault.read("a")).rejects.toThrow(/cannot be read/);
      await chmod(join(home, "vault.json"), 0o600);
      expect(await vault.read("a")).toEqual(credential);
    },
  );

  it("throws when vault.json is a directory", async () => {
    await mkdir(join(home, "vault.json"));
    await expect(open()).rejects.toThrow(/cannot be read/);
  });
});
