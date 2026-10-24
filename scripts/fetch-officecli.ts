/**
 * Downloads the OfficeCLI binary (https://github.com/iOfficeAI/OfficeCLI, Apache-2.0) that the
 * desktop app bundles, into apps/desktop/resources/officecli/<platform>-<arch>/ (git-ignored).
 *
 *   node scripts/fetch-officecli.ts                 the platform this machine runs on
 *   node scripts/fetch-officecli.ts mac-x64 win-x64  the listed platforms
 *   node scripts/fetch-officecli.ts --all            every platform
 *
 * The version and the SHA-256 of every asset are pinned below; a download that does not match is
 * discarded, and nothing is fetched from an unpinned location. To update, change VERSION and copy
 * the digests from the release's `SHA256SUMS` (the release page lists them per asset).
 */
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const VERSION = "1.0.158";

interface Asset {
  /** Release asset name. */
  asset: string;
  /** File name inside the platform folder. */
  file: string;
  sha256: string;
}

/** Keyed like electron-builder's `${os}-${arch}`, which `electron-builder.yml` uses to pick one. */
const ASSETS: Record<string, Asset> = {
  "mac-arm64": {
    asset: "officecli-mac-arm64",
    file: "officecli",
    sha256: "67cf08d95fab556cad9d1e9d0d3b76a7962b5658c716aeaef2e83cbc19af7ff7",
  },
  "mac-x64": {
    asset: "officecli-mac-x64",
    file: "officecli",
    sha256: "038716417adb626d5e94bc71dfecea2d2be9838f3d9b2eb49c2f0b3d634cf4f2",
  },
  "win-x64": {
    asset: "officecli-win-x64.exe",
    file: "officecli.exe",
    sha256: "117545f3bc817d7c6d2e78a62e4f73f75b918ccd61558e404c60949a8cb9fd1f",
  },
  "win-arm64": {
    asset: "officecli-win-arm64.exe",
    file: "officecli.exe",
    sha256: "48567b4bc5a124fb0a709bac29a1e13b6760f094741d0e2bb755680ec9e51295",
  },
  "linux-x64": {
    asset: "officecli-linux-x64",
    file: "officecli",
    sha256: "9ee41d5558caea7bcd5aab1b3e76b2bd70f0535f09cf65dda3668130510cc719",
  },
  "linux-arm64": {
    asset: "officecli-linux-arm64",
    file: "officecli",
    sha256: "b1d5e74d93a8471a47b037cc7774ac29c559940e226f99b9fdf788966cc395b8",
  },
};

const OUTPUT = join(import.meta.dirname, "..", "apps", "desktop", "resources", "officecli");

function hostKey(): string {
  const os = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";
  return `${os}-${process.arch}`;
}

async function fetchOne(key: string): Promise<void> {
  const entry = ASSETS[key];
  if (!entry)
    throw new Error(`No OfficeCLI build for ${key}. Available: ${Object.keys(ASSETS).join(", ")}.`);
  const target = join(OUTPUT, key, entry.file);

  const existing = await readFile(target).catch(() => null);
  if (existing && createHash("sha256").update(existing).digest("hex") === entry.sha256) {
    console.log(`${key}: OfficeCLI ${VERSION} already in place`);
    return;
  }

  const url = `https://github.com/iOfficeAI/OfficeCLI/releases/download/v${VERSION}/${entry.asset}`;
  console.log(`${key}: downloading ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  const actual = createHash("sha256").update(data).digest("hex");
  if (actual !== entry.sha256)
    throw new Error(
      `${entry.asset}: SHA-256 is ${actual}, expected ${entry.sha256}. Not installed.`,
    );

  await mkdir(dirname(target), { recursive: true });
  const partial = `${target}.partial`;
  try {
    await writeFile(partial, data);
    await chmod(partial, 0o755);
    await rename(partial, target);
  } finally {
    await rm(partial, { force: true });
  }
  console.log(`${key}: OfficeCLI ${VERSION} verified and installed`);
}

const args = process.argv.slice(2);
const keys = args.includes("--all") ? Object.keys(ASSETS) : args.length > 0 ? args : [hostKey()];
for (const key of keys) await fetchOne(key);
