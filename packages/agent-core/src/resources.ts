/**
 * Finding and safely running the external executables the app ships or expects on this computer
 * (OfficeCLI, whisper.cpp). A binary is looked up in the app's resources folder for this platform,
 * and the child process starts with a scrubbed environment: no credentials, proxies or API keys.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Variables a command may inherit. Credentials, proxies and API keys are not among them. */
export const INHERITED_ENV = [
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "SYSTEMROOT",
  "windir",
  "COMSPEC",
  "PATHEXT",
  "DISPLAY",
  "WAYLAND_DISPLAY",
];

/** The inherited variables of `base`, nothing else. */
export function scrubbedEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of INHERITED_ENV) if (base[name] !== undefined) env[name] = base[name];
  return env;
}

/** `mac-arm64`, `win-x64`, `linux-x64`: the folder name under `resources/<tool>/`. */
export function platformKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  const os = platform === "darwin" ? "mac" : platform === "win32" ? "win" : "linux";
  return `${os}-${arch}`;
}

let configuredResourcesDir: string | null = null;

/** Folder the host was told holds the app's resources (`AgentPaths.resourcesDir`). */
export function configureResourcesDir(dir: string | undefined): void {
  configuredResourcesDir = dir ?? null;
}

/**
 * A folder shipped with the app (`extraResources`): the configured resources folder first, then
 * `process.resourcesPath` (Electron), then `apps/desktop/resources` when running from a bundle in
 * `apps/desktop/dist` or from source in development.
 */
export function resourcePath(...parts: string[]): string | null {
  // Set by Electron only; this package does not depend on its types.
  const { resourcesPath } = process as NodeJS.Process & { resourcesPath?: string };
  const roots = [
    configuredResourcesDir ? join(configuredResourcesDir, ...parts) : null,
    resourcesPath ? join(resourcesPath, ...parts) : null,
    // Bundled: dist/daemon.mjs sits next to apps/desktop/resources.
    join(import.meta.dirname, "..", "resources", ...parts),
    // From source: packages/agent-core/src.
    join(import.meta.dirname, "..", "..", "..", "apps", "desktop", "resources", ...parts),
  ];
  return roots.find((root): root is string => root !== null && existsSync(root)) ?? null;
}
