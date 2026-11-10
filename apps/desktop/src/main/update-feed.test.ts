import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  fetchSignedFeed,
  installerSha512,
  isNewer,
  parseFeed,
  sha512File,
  verifyFeed,
} from "./update-feed.ts";

/** A throwaway keypair: the real one lives in the repository secret, the app carries its public half. */
function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  };
}

const FEED = `version: 2.0.0
files:
  - url: pp-agent-2.0.0-win-x64.exe
    sha512: signed-hash
    size: 100
path: pp-agent-2.0.0-win-x64.exe
sha512: signed-hash
`;

describe("feed signature", () => {
  it("accepts a feed signed by a key the app carries", () => {
    const { privateKey, publicKey } = keypair();
    const signature = sign(null, Buffer.from(FEED), privateKey).toString("base64");
    expect(verifyFeed(FEED, signature, [publicKey])).toBe(true);
  });

  it("rejects a changed byte, another key and a truncated signature", () => {
    const { privateKey, publicKey } = keypair();
    const signature = sign(null, Buffer.from(FEED), privateKey).toString("base64");
    expect(verifyFeed(FEED.replace("signed-hash", "other-hash"), signature, [publicKey])).toBe(
      false,
    );
    expect(verifyFeed(FEED, signature, [keypair().publicKey])).toBe(false);
    expect(verifyFeed(FEED, signature.slice(0, 40), [publicKey])).toBe(false);
  });

  it("ignores a malformed key instead of throwing", () => {
    const { privateKey, publicKey } = keypair();
    const signature = sign(null, Buffer.from(FEED), privateKey).toString("base64");
    expect(verifyFeed(FEED, signature, ["not-a-key", publicKey])).toBe(true);
  });
});

describe("feed contents", () => {
  it("reads the version and the files", () => {
    expect(parseFeed(FEED)).toEqual({
      version: "2.0.0",
      files: [{ url: "pp-agent-2.0.0-win-x64.exe", sha512: "signed-hash" }],
    });
  });

  it("refuses a feed without a version or files", () => {
    expect(() => parseFeed("path: x.exe\n")).toThrow("no valid version");
    expect(() => parseFeed("version: 2.0\nfiles: []\n")).toThrow("no valid version");
    expect(() => parseFeed("version: 2.0.0\nfiles: []\n")).toThrow("no files");
    expect(() => parseFeed("version: 2.0.0\nfiles:\n  - url: x.exe\n")).toThrow("malformed");
  });

  it("picks the Windows installer's hash", () => {
    expect(installerSha512(parseFeed(FEED), ".exe")).toBe("signed-hash");
    expect(() => installerSha512(parseFeed(FEED), ".dmg")).toThrow("no .dmg installer");
  });
});

describe("downloaded installer", () => {
  it("hashes the file the same way the feed records it", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pp-feed-")), "installer.exe");
    writeFileSync(path, "installer bytes");
    expect(await sha512File(path)).toBe(
      createHash("sha512").update("installer bytes").digest("base64"),
    );
  });

  it("rejects when the file cannot be read", async () => {
    await expect(sha512File(join(tmpdir(), "no-such-pp-installer"))).rejects.toThrow();
  });
});

/** The URL a mocked `fetch` was asked for: a string, a `URL`, or a `Request`. */
function requestedUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

describe("fetching the latest feed", () => {
  it("accepts the feed and signature GitHub serves", async () => {
    const { privateKey, publicKey } = keypair();
    const signature = sign(null, Buffer.from(FEED), privateKey).toString("base64");
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) =>
        new Response(requestedUrl(input).endsWith(".sig") ? signature : FEED, { status: 200 }),
    );
    await expect(fetchSignedFeed("PP-Agent/1.2.3", [publicKey])).resolves.toMatchObject({
      version: "2.0.0",
    });
    vi.restoreAllMocks();
  });

  it("refuses a feed whose signature does not match", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(FEED.replace("signed-hash", "other-hash"), { status: 200 }),
    );
    await expect(fetchSignedFeed("PP-Agent/1.2.3", [keypair().publicKey])).rejects.toThrow(
      "signature does not match",
    );
    vi.restoreAllMocks();
  });

  it("refuses when GitHub has no signature beside the feed", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      requestedUrl(input).endsWith(".sig")
        ? new Response("Not Found", { status: 404 })
        : new Response(FEED, { status: 200 }),
    );
    await expect(fetchSignedFeed("PP-Agent/1.2.3", [keypair().publicKey])).rejects.toThrow(
      "GitHub answered 404",
    );
    vi.restoreAllMocks();
  });
});

describe("version comparison", () => {
  it("compares plain versions and ignores a prerelease suffix", () => {
    expect(isNewer("2.0.0", "1.2.3")).toBe(true);
    expect(isNewer("1.2.3", "1.2.3")).toBe(false);
    expect(isNewer("1.2.9", "1.3.0")).toBe(false);
    expect(isNewer("0.31.0", "0.31.0-beta.1")).toBe(false);
    expect(isNewer("2.0.0", "not-a-version")).toBe(false);
  });
});
