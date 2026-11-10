import { resolve } from "node:path";
import { defineConfig } from "vite-plus";
import type { PackUserConfig } from "vite-plus/pack";

/**
 * Data folder of `dev:isolated`: its own settings, vault and sessions, so the daemon it starts
 * listens on its own socket instead of the one the app on this computer already uses.
 */
const ISOLATED_HOME = resolve(import.meta.dirname, "../../tmp/pp-agent-dev");

const shared: PackUserConfig = {
  platform: "node",
  target: "node24",
  outDir: "dist",
  sourcemap: true,
  // Electron is provided by the runtime; pi stays in node_modules (it loads assets and wasm at runtime),
  // and so do the keyring and the terminal (native addons).
  deps: { neverBundle: ["electron", "@napi-rs/keyring", "node-pty"] },
};

export default defineConfig({
  pack: [
    {
      ...shared,
      // The cookie reader runs as a utility process (src/main/browser/cookies/reader-process.ts).
      entry: {
        main: "src/main/index.ts",
        daemon: "../daemon/src/index.ts",
        cookieReader: "src/main/browser/cookies/reader.ts",
      },
      format: "esm",
    },
    {
      ...shared,
      // Sandboxed preload scripts must be CommonJS.
      entry: { preload: "src/preload/index.ts" },
      format: "cjs",
      clean: false,
    },
  ],
  run: {
    tasks: {
      // Never cached: cache tracking injects a file-access hook into child processes, which
      // crashes Electron's sandboxed renderer (blank window).
      dev: { command: "vp pack && electron .", cache: false },
      // A second app beside the one on this computer: its daemon gets its own socket, vault and
      // sessions. Start the renderer first (`vp dev` in apps/web). Leave Background and the chat
      // channels off here: the login service is single per person, and a second poller with the
      // same bot token fights the real daemon for it.
      "dev:isolated": {
        command: `vp pack && electron . --user-data-dir="${ISOLATED_HOME}"`,
        cache: false,
      },
    },
  },
});
