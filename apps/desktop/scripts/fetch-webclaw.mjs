#!/usr/bin/env node
/**
 * Downloads the webclaw binary (AGPL-3.0, https://github.com/0xMassi/webclaw) for one platform into
 * resources/webclaw/<os>-<arch>/, where electron-builder picks it up (extraResources) and the app
 * finds it in development. The archive is checked against the SHA-256 pinned below.
 *
 *   node scripts/fetch-webclaw.mjs                       this computer
 *   node scripts/fetch-webclaw.mjs --platform win32 --arch x64
 *   node scripts/fetch-webclaw.mjs --require             fail when there is no build for the target
 *
 * Without a build for the target (Windows on ARM) it prints a warning and stops: the app then
 * converts pages with its own code. To update, change VERSION and the hashes from the release's
 * SHA256SUMS file.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.7.0";

/** `<platform>-<arch>` (Node names) → release asset and its SHA-256. Linux uses the static musl builds. */
const ASSETS = {
  "darwin-arm64": [
    "aarch64-apple-darwin.tar.gz",
    "14e39807f1562e72911f4e166e0493ecb8207f3f4188284d4ea671c529d4717a",
  ],
  "darwin-x64": [
    "x86_64-apple-darwin.tar.gz",
    "cba9954348dfad76cc9ca99e8fccaae9b9ef9a7e9ed4946803dad12243d84061",
  ],
  "linux-arm64": [
    "aarch64-unknown-linux-musl.tar.gz",
    "9911b05d84e99c2059ebd93d2917d2916453739ea1eef5ee23e6a1b92ff3449d",
  ],
  "linux-x64": [
    "x86_64-unknown-linux-musl.tar.gz",
    "c54b24ed07bec41238be1c8ca3d83e4aea5f45730db3d077a779b500b8e8aa10",
  ],
  "win32-x64": [
    "x86_64-pc-windows-msvc.zip",
    "a4523ba10f3232e91f3e42805373964d34e828cd88c69d991af71abb55f5cace",
  ],
};

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const platform = option("platform") ?? process.platform;
const arch = option("arch") ?? process.arch;
const required = process.argv.includes("--require");
const asset = ASSETS[`${platform}-${arch}`];

if (!asset) {
  const message = `webclaw has no build for ${platform}-${arch}; pages will be converted without it.`;
  if (required) {
    console.error(message);
    process.exit(1);
  }
  console.warn(message);
  process.exit(0);
}

const [suffix, sha256] = asset;
const os = platform === "darwin" ? "mac" : platform === "win32" ? "win" : "linux";
const binaryName = platform === "win32" ? "webclaw.exe" : "webclaw";
const target = join(
  fileURLToPath(new URL("../resources/webclaw/", import.meta.url)),
  `${os}-${arch}`,
);
const binaryPath = join(target, binaryName);
const stamp = join(target, ".version");

if (existsSync(binaryPath) && existsSync(stamp) && readFileSync(stamp, "utf8").trim() === VERSION) {
  console.log(`webclaw ${VERSION} is already in ${target}`);
  process.exit(0);
}

const name = `webclaw-v${VERSION}-${suffix}`;
const url = `https://github.com/0xMassi/webclaw/releases/download/v${VERSION}/${name}`;
console.log(`Downloading ${url}`);
const response = await fetch(url);
if (!response.ok) {
  console.error(`Download failed: ${response.status} ${response.statusText}`);
  process.exit(1);
}
const archive = Buffer.from(await response.arrayBuffer());
const actual = createHash("sha256").update(archive).digest("hex");
if (actual !== sha256) {
  console.error(`Checksum mismatch for ${name}: expected ${sha256}, got ${actual}`);
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "webclaw-"));
try {
  const file = join(work, name);
  writeFileSync(file, archive);
  // bsdtar (macOS, Windows 10+) and GNU tar both read these formats; bsdtar also reads the .zip.
  execFileSync("tar", ["-xf", file, "-C", work], { stdio: "inherit" });
  mkdirSync(target, { recursive: true });
  copyFileSync(join(work, name.replace(/\.(tar\.gz|zip)$/, ""), binaryName), binaryPath);
  if (platform !== "win32") chmodSync(binaryPath, 0o755);
  writeFileSync(stamp, `${VERSION}\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`webclaw ${VERSION} installed in ${target}`);
