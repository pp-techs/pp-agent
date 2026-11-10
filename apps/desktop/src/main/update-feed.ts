import { createHash, createPublicKey, verify } from "node:crypto";
import { createReadStream } from "node:fs";
import { parse } from "yaml";

/** The repository the app reads releases and the update feed from. */
export const REPO = "pp-techs/pp-agent";

const FEED_URL = `https://github.com/${REPO}/releases/latest/download/latest.yml`;
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Ed25519 public keys (base64 SPKI) that may sign `latest.yml`.
 *
 * The `publish` job signs every feed with `UPDATE_SIGNING_KEY` (docs/code-standard/release-process.md)
 * and the app installs only an installer whose SHA-512 appears in a feed one of these keys signed.
 * Everything else in a release — the installer and the feed beside it — can be replaced by anyone
 * who can publish to the repository; the signature is the part they cannot forge, so in-app updates
 * do not need a Windows code-signing certificate.
 *
 * Rotation: add the new key here, ship a build that carries both, sign with the new key, and remove
 * the old key in a later release. An install that only knows the old key refuses a feed signed with
 * the new one, so never replace the list outright.
 */
export const FEED_PUBLIC_KEYS: readonly string[] = [
  "MCowBQYDK2VwAyEAGym8OM/yEhTN7J0vf7lR/Wz8ZDcaTx8ryCb7cR4B1OA=",
];

export interface Feed {
  readonly version: string;
  readonly files: readonly { readonly url: string; readonly sha512: string }[];
}

/**
 * Compares plain `x.y.z` versions; anything else counts as not newer. A prerelease suffix is
 * ignored: `0.31.0-beta.1` and `0.31.0` compare equal, and releases are never prereleases.
 */
export function isNewer(candidate: string, current: string): boolean {
  const parseVersion = (version: string) => version.split("-")[0]!.split(".").map(Number);
  const [a, b] = [parseVersion(candidate), parseVersion(current)];
  for (let i = 0; i < 3; i++) {
    const [x, y] = [a[i] ?? Number.NaN, b[i] ?? Number.NaN];
    if (Number.isNaN(x) || Number.isNaN(y)) return false;
    if (x !== y) return x > y;
  }
  return false;
}

/** The `version` and `files` of a feed, checked before anything in it is trusted. */
export function parseFeed(text: string): Feed {
  const document: unknown = parse(text);
  if (typeof document !== "object" || document === null)
    throw new Error("Update feed is not a mapping");
  const { version, files } = document as Record<string, unknown>;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error("Update feed has no valid version");
  if (!Array.isArray(files) || files.length === 0) throw new Error("Update feed has no files");
  return {
    version,
    files: files.map((entry) => {
      if (typeof entry !== "object" || entry === null)
        throw new Error("Update feed has a malformed file entry");
      const { url, sha512 } = entry as Record<string, unknown>;
      if (typeof url !== "string" || typeof sha512 !== "string")
        throw new Error("Update feed has a malformed file entry");
      return { url, sha512 };
    }),
  };
}

/** True when one of `keys` signed exactly `text`. */
export function verifyFeed(
  text: string,
  signatureBase64: string,
  keys: readonly string[] = FEED_PUBLIC_KEYS,
): boolean {
  const signature = Buffer.from(signatureBase64.trim(), "base64");
  if (signature.length !== 64) return false;
  const data = Buffer.from(text, "utf8");
  for (const key of keys) {
    try {
      if (
        verify(
          null,
          data,
          createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" }),
          signature,
        )
      )
        return true;
    } catch {
      // A malformed key must not hide a good one.
    }
  }
  return false;
}

/** The latest feed, after checking its signature. Throws when GitHub answers oddly or it is forged. */
export async function fetchSignedFeed(
  userAgent: string,
  keys: readonly string[] = FEED_PUBLIC_KEYS,
): Promise<Feed> {
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const headers = { "User-Agent": userAgent };
  const [feed, signature] = await Promise.all([
    fetch(FEED_URL, { headers, signal }),
    fetch(`${FEED_URL}.sig`, { headers, signal }),
  ]);
  for (const response of [feed, signature]) {
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  }
  const [text, signed] = await Promise.all([feed.text(), signature.text()]);
  if (!verifyFeed(text, signed, keys)) throw new Error("Update feed signature does not match");
  return parseFeed(text);
}

/** The SHA-512 (base64) of the installer in `feed`, matched by file extension. */
export function installerSha512(feed: Feed, extension: string): string {
  const installer = feed.files.find((file) => file.url.toLowerCase().endsWith(extension));
  if (installer === undefined) throw new Error(`Update feed has no ${extension} installer`);
  return installer.sha512;
}

/** SHA-512 (base64) of a file, streamed so a 200 MB installer does not block the main process. */
export function sha512File(path: string): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const hash = createHash("sha512");
  createReadStream(path)
    .on("data", (chunk) => hash.update(chunk))
    .on("error", reject)
    .on("end", () => resolve(hash.digest("base64")));
  return promise;
}
