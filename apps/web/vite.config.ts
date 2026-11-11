import { createReadStream, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { ARTIFACT_SCHEME, REMOTE_DEFAULT_PORT } from "@workspace/shared";
import { defineConfig, type Plugin } from "vite-plus";

/**
 * Locks the packaged renderer down: no remote scripts and no network access; everything goes through
 * the preload bridge. Dev builds skip it because the dev server injects inline scripts for HMR.
 *
 * The phone app's build (`--mode mobile`, bundled into apps/mobile) talks to the computer the person
 * connects to, at an address only known at run time, so it may connect anywhere over HTTP(S).
 */
function contentSecurityPolicy(mode: string) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    // No remote images: one in a reply would load as soon as it shows and could carry what the
    // agent read to any server. Pasted images and file previews are `data:`/`blob:` URLs.
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    mode === "mobile" ? "connect-src 'self' http: https:" : "connect-src 'self'",
    "object-src 'none'",
    // HTML previews: the desktop app's sandboxed frame scheme, or (a browser and the phone) the
    // frame page bundled beside the app, which carries the stricter policy of its own.
    `frame-src 'self' ${ARTIFACT_SCHEME}:`,
    "base-uri 'none'",
  ].join("; ");
}

function contentSecurityPolicyTag(mode: string): Plugin {
  return {
    name: "pp-agent:csp",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: contentSecurityPolicy(mode) },
        injectTo: "head-prepend",
      },
    ],
  };
}

/**
 * Libraries an HTML preview may load, at `artifact-libs/<name>` beside the frame page. The desktop
 * app serves the same files from its scheme; here they are copied from `node_modules` at build and
 * streamed by the dev server, so a phone has the chart library offline.
 */
const ARTIFACT_LIBRARIES: Record<string, string> = {
  "chart.js": "chart.js/dist/chart.umd.min.js",
};

function artifactLibraries(): Plugin {
  const file = (name: string) =>
    fileURLToPath(new URL(`./node_modules/${ARTIFACT_LIBRARIES[name]}`, import.meta.url));
  return {
    name: "pp-agent:artifact-libraries",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = /^\/artifact-libs\/([^/?#]+)$/.exec(req.url ?? "")?.[1];
        if (!name || !Object.hasOwn(ARTIFACT_LIBRARIES, name)) return next();
        res.setHeader("Content-Type", "text/javascript; charset=utf-8");
        createReadStream(file(name)).pipe(res);
      });
    },
    generateBundle() {
      for (const name of Object.keys(ARTIFACT_LIBRARIES))
        this.emitFile({
          type: "asset",
          fileName: `artifact-libs/${name}`,
          source: readFileSync(file(name)),
        });
    },
  };
}

export default defineConfig(({ mode }) => ({
  // Relative asset URLs so the packaged desktop app can load dist/index.html over file://.
  base: "./",
  plugins: [react(), tailwindcss(), contentSecurityPolicyTag(mode), artifactLibraries()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 47821,
    strictPort: true,
    // Opened in a plain browser (`vp dev --host` for a phone), the app talks to the daemon's web
    // API: turn on Settings › Remote access in the desktop app first.
    proxy: {
      "/api": { target: `http://127.0.0.1:${REMOTE_DEFAULT_PORT}` },
    },
  },
  // The renderer half of the root `dev:isolated` script: same server, run beside an app whose data
  // and daemon live in tmp/ (see the task of that name in apps/desktop).
  run: {
    tasks: {
      "dev:isolated": { command: "vp dev", cache: false },
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // Libraries in their own files, so they stay cached when the app's code changes.
        codeSplitting: {
          groups: [
            { name: "react", test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
}));
