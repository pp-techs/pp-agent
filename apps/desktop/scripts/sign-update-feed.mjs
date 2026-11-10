#!/usr/bin/env node
/**
 * Signs the update feeds of a release so installed apps can tell a release apart from one that was
 * replaced after publishing.
 *
 *   node scripts/sign-update-feed.mjs <assets dir>
 *
 * Reads the Ed25519 private key from UPDATE_SIGNING_KEY (base64 of a PKCS#8 PEM) — a repository
 * secret used by the `publish` job only — and writes `<feed>.sig` (base64 of the 64-byte detached
 * signature) next to each feed. The matching public key is FEED_PUBLIC_KEYS in
 * src/main/update-feed.ts. See docs/code-standard/release-process.md to create or rotate the key.
 */
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FEEDS = ["latest.yml", "latest-linux.yml", "latest-mac.yml"];

function fail(message) {
  console.error(`sign-update-feed: ${message}`);
  process.exit(1);
}

const directory = process.argv[2];
if (directory === undefined) fail("usage: sign-update-feed.mjs <assets dir>");

const encodedKey = process.env.UPDATE_SIGNING_KEY;
if (encodedKey === undefined || encodedKey.trim() === "")
  fail(
    "UPDATE_SIGNING_KEY is not set (repository secret, see docs/code-standard/release-process.md)",
  );

let key;
try {
  key = createPrivateKey(Buffer.from(encodedKey.trim(), "base64").toString("utf8"));
} catch (error) {
  fail(`UPDATE_SIGNING_KEY is not a base64 PKCS#8 PEM: ${error.message}`);
}
if (key.asymmetricKeyType !== "ed25519")
  fail(`UPDATE_SIGNING_KEY is ${key.asymmetricKeyType}, not ed25519`);

for (const feed of FEEDS) {
  let bytes;
  try {
    bytes = readFileSync(join(directory, feed));
  } catch {
    fail(`missing ${feed} in ${directory}`);
  }
  writeFileSync(join(directory, `${feed}.sig`), `${sign(null, bytes, key).toString("base64")}\n`);
  console.log(`signed ${feed}`);
}
