#!/usr/bin/env node
/**
 * Downloads cua-driver (MIT, https://github.com/trycua/cua) for one platform into
 * resources/cua-driver/<os>-<arch>/, where electron-builder picks it up (extraResources) and the app
 * finds it in development. The archive is checked against the SHA-256 pinned below. The agent's
 * computer tool runs it; without it the tool says computer use is not part of the build.
 *
 *   node scripts/fetch-cua-driver.mjs                       this computer
 *   node scripts/fetch-cua-driver.mjs --platform win32 --arch x64
 *   node scripts/fetch-cua-driver.mjs --require             fail when there is no build for the target
 *
 * Computer use runs on macOS and Windows; elsewhere it prints a note and stops. macOS gets the
 * universal binary reduced to the target architecture with lipo (when lipo is there). To update,
 * change VERSION and the hashes from the release's SHA256SUMS file.
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

const VERSION = "0.38.0";

const MAC = [
  "darwin-universal-binary.tar.gz",
  "2bb8dc4a7e69185ffd04c4a9c0eab590bd2c54b72c2c1be13ab675be4f487732",
  ["cua-driver"],
];

/** `<platform>-<arch>` (Node names) → release asset, its SHA-256, and the programs it ships. */
const ASSETS = {
  "darwin-arm64": MAC,
  "darwin-x64": MAC,
  "win32-x64": [
    "windows-x86_64-binary.zip",
    "5edaa74d0afa1b55a9668dbc4f32736507bd2bd4d75b18ca1dc8881bb12402b5",
    // cua-driver-uia.exe reads UI Automation trees for cua-driver.exe.
    ["cua-driver.exe", "cua-driver-uia.exe"],
  ],
  "win32-arm64": [
    "windows-arm64-binary.zip",
    "d25c8ebfffb34e4c095ea170baf47b87c35dc0d1116f42e46b39df2bcbff8700",
    ["cua-driver.exe", "cua-driver-uia.exe"],
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
  const message = `cua-driver is not bundled for ${platform}-${arch}; computer use will be unavailable.`;
  if (required) {
    console.error(message);
    process.exit(1);
  }
  console.log(message);
  process.exit(0);
}

const [suffix, sha256, programs] = asset;
const os = platform === "darwin" ? "mac" : "win";
const target = join(
  fileURLToPath(new URL("../resources/cua-driver/", import.meta.url)),
  `${os}-${arch}`,
);
const stamp = join(target, ".version");

if (
  programs.every((name) => existsSync(join(target, name))) &&
  existsSync(stamp) &&
  readFileSync(stamp, "utf8").trim() === VERSION
) {
  console.log(`cua-driver ${VERSION} is already in ${target}`);
  process.exit(0);
}

const name = `cua-driver-rs-${VERSION}-${suffix}`;
const url = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${VERSION}/${name}`;
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

/**
 * Windows: the tar.exe of Windows itself (bsdtar), which reads .zip files. The `tar` that Git's bash
 * puts first in PATH is GNU tar: it takes `C:` for a remote host and cannot read zip.
 */
function extract(file, dir) {
  if (process.platform === "win32") {
    const system32 = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
    execFileSync(join(system32, "tar.exe"), ["-xf", file, "-C", dir], { stdio: "inherit" });
  } else if (file.endsWith(".zip"))
    execFileSync("unzip", ["-q", file, "-d", dir], { stdio: "inherit" });
  else execFileSync("tar", ["-xzf", file, "-C", dir], { stdio: "inherit" });
}

/** The universal binary holds both architectures; keep only the target's (about half the size). */
function thin(source, destination) {
  try {
    execFileSync("lipo", [
      source,
      "-thin",
      arch === "x64" ? "x86_64" : arch,
      "-output",
      destination,
    ]);
  } catch {
    console.warn("lipo is not available; bundling the universal binary.");
    copyFileSync(source, destination);
  }
}

const work = mkdtempSync(join(tmpdir(), "cua-driver-"));
try {
  const file = join(work, name);
  writeFileSync(file, archive);
  extract(file, work);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const program of programs) {
    const destination = join(target, program);
    if (platform === "darwin") thin(join(work, program), destination);
    else copyFileSync(join(work, program), destination);
    if (platform !== "win32") chmodSync(destination, 0o755);
  }
  writeFileSync(stamp, `${VERSION}\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`cua-driver ${VERSION} installed in ${target}`);
