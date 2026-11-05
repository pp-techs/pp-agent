import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Folder of the built web app (`apps/web/dist`) to serve on the local network, or null when there
 * is none. `PP_AGENT_WEB_DIR` wins; a packaged app has it in `resources/renderer`; a development
 * checkout has it beside the daemon's own bundle (`apps/desktop/dist`) or source (`apps/daemon/src`).
 */
export function findWebDir(
  env: NodeJS.ProcessEnv = process.env,
  moduleUrl: string = import.meta.url,
): string | null {
  const here = fileURLToPath(new URL(".", moduleUrl));
  const candidates = [
    env.PP_AGENT_WEB_DIR,
    env.PP_AGENT_RESOURCES ? join(env.PP_AGENT_RESOURCES, "renderer") : undefined,
    join(here, "..", "..", "web", "dist"),
    join(here, "..", "..", "..", "web", "dist"),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(join(candidate, "index.html"))) return candidate;
  }
  return null;
}
