import { defineConfig } from "vite-plus";
import type { PackUserConfig } from "vite-plus/pack";

const shared: PackUserConfig = {
  platform: "node",
  target: "node24",
  outDir: "dist",
  sourcemap: true,
  // Electron is provided by the runtime; pi stays in node_modules (it loads assets and wasm at runtime),
  // and so does the keyring (a native addon).
  deps: { neverBundle: ["electron", "@napi-rs/keyring"] },
};

export default defineConfig({
  pack: [
    {
      ...shared,
      entry: { main: "src/main/index.ts", daemon: "../daemon/src/index.ts" },
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
    },
  },
});
