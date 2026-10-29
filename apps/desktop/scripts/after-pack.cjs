/**
 * electron-builder `afterPack` hook. node-pty 1.1 publishes its macOS `spawn-helper` without the
 * execute bit, so the side panel terminal fails with "posix_spawnp failed". The packed app is still
 * writable here (signing comes after), so set the bit on the unpacked copy.
 */
const { chmodSync, existsSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = `${context.packager.appInfo.productFilename}.app`;
  const prebuilds = join(
    context.appOutDir,
    app,
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "node_modules",
    "node-pty",
    "prebuilds",
  );
  if (!existsSync(prebuilds)) throw new Error(`node-pty prebuilds missing at ${prebuilds}`);
  for (const platform of readdirSync(prebuilds)) {
    const helper = join(prebuilds, platform, "spawn-helper");
    if (existsSync(helper)) chmodSync(helper, 0o755);
  }
};
