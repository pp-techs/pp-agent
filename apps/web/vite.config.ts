import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { REMOTE_DEFAULT_PORT } from "@workspace/shared";
import { defineConfig, type Plugin } from "vite-plus";

/**
 * Locks the packaged renderer down: no remote scripts and no network access; everything goes through
 * the preload bridge. Dev builds skip it because the dev server injects inline scripts for HMR.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");

const contentSecurityPolicy: Plugin = {
  name: "pp-agent:csp",
  apply: "build",
  transformIndexHtml: () => [
    {
      tag: "meta",
      attrs: { "http-equiv": "Content-Security-Policy", content: CONTENT_SECURITY_POLICY },
      injectTo: "head-prepend",
    },
  ],
};

export default defineConfig({
  // Relative asset URLs so the packaged desktop app can load dist/index.html over file://.
  base: "./",
  plugins: [react(), tailwindcss(), contentSecurityPolicy],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 47821,
    strictPort: true,
    // Opened in a plain browser (`vp dev --host` for a phone), the app talks to the daemon's web
    // API: turn on Settings › Phone access in the desktop app first.
    proxy: {
      "/api": { target: `http://127.0.0.1:${REMOTE_DEFAULT_PORT}` },
    },
  },
  build: {
    // Loaded from disk inside the desktop app, so bundle size matters far less than on the web.
    chunkSizeWarningLimit: 2_000,
  },
});
