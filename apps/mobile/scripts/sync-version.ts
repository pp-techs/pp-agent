/**
 * Gives the native projects this package's version (kept in lockstep with the desktop app by
 * changesets), so the phone app and the computer it pairs with show the same release. The build
 * number both stores require to grow is derived from it: 0.23.1 becomes 2301.
 *
 * Runs as part of `vp run sync`; run it alone with `node scripts/sync-version.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  version: string;
};
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
if (!match) throw new Error(`Unexpected version ${version}: expected major.minor.patch.`);
const [major, minor, patch] = match.slice(1).map(Number) as [number, number, number];
if (minor > 99 || patch > 99) throw new Error(`Version ${version} does not fit the build number.`);
const build = String(major * 10_000 + minor * 100 + patch);

function update(file: string, replacements: [RegExp, string][]): void {
  const path = join(root, file);
  let text = readFileSync(path, "utf8");
  for (const [pattern, value] of replacements) {
    if (!pattern.test(text)) throw new Error(`${file}: ${pattern} not found.`);
    text = text.replace(pattern, value);
  }
  writeFileSync(path, text);
}

update("ios/App/App.xcodeproj/project.pbxproj", [
  [/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`],
  [/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`],
]);
update("android/app/build.gradle", [
  [/versionCode \d+/, `versionCode ${build}`],
  [/versionName "[^"]*"/, `versionName "${version}"`],
]);
console.log(`Native projects set to ${version} (build ${build}).`);
