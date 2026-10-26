import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    {
      platform: "node",
      target: "node24",
      outDir: "dist",
      sourcemap: true,
      format: "esm",
      entry: { daemon: "src/index.ts" },
    },
  ],
});
