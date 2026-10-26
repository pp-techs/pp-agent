import { execFile } from "node:child_process";
import { delimiter } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const MARKER = "__PP_AGENT_PATH__";
const TIMEOUT_MS = 5_000;

/**
 * PATH as the user's login shell sees it. An app opened from Finder or the Dock gets the minimal
 * launchd PATH, so MCP commands such as `npx` or `uvx` would not be found. Windows apps inherit the
 * full PATH, so nothing changes there. Returns `process.env.PATH` when the shell cannot be asked.
 */
export async function resolveShellPath(): Promise<string | undefined> {
  const current = process.env.PATH;
  if (process.platform === "win32") return current;
  const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/sh");
  try {
    // Markers separate PATH from whatever the shell's startup files print. `printenv` works the
    // same in fish, where `$PATH` expands to a list.
    const { stdout } = await run(
      shell,
      ["-ilc", `printf '%s' ${MARKER}; printenv PATH; printf '%s' ${MARKER}`],
      {
        timeout: TIMEOUT_MS,
        env: { ...process.env, DISABLE_AUTO_UPDATE: "true" },
      },
    );
    const start = stdout.indexOf(MARKER);
    const end = stdout.lastIndexOf(MARKER);
    if (start === -1 || end <= start) return current;
    const shellPath = stdout.slice(start + MARKER.length, end).trim();
    if (!shellPath) return current;
    // Keep entries only the app has; shell entries come first.
    const entries = [...shellPath.split(delimiter), ...(current?.split(delimiter) ?? [])];
    return [...new Set(entries.filter(Boolean))].join(delimiter);
  } catch (error) {
    console.error("Could not read the login shell PATH:", error);
    return current;
  }
}
