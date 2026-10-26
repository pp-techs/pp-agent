import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentPaths } from "@workspace/shared";

/** Folder name Electron's `userData` uses (the product name), so the daemon shares the app's data. */
const APP_FOLDER = "PP Agent";
/** Longest Unix socket path used as is; sockaddr_un holds 104 bytes on macOS and 108 on Linux. */
const MAX_SOCKET_PATH = 100;

export interface DaemonPaths {
  /** Folder with settings.json, agent/, sessions/, logs/, vault, socket and token. */
  home: string;
  /** Unix socket path, or a named pipe name on Windows. */
  endpoint: string;
  tokenFile: string;
  logFile: string;
  agent: AgentPaths;
}

interface Platform {
  platform: NodeJS.Platform;
  /** Owner of `/tmp/pp-agent-<uid>`; unused on Windows. */
  uid: number;
}

function currentPlatform(): Platform {
  return { platform: process.platform, uid: process.getuid?.() ?? 0 };
}

/** `PP_AGENT_HOME`, else where Electron keeps `userData` on this system. */
export function resolveHome(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (env.PP_AGENT_HOME) return env.PP_AGENT_HOME;
  switch (platform) {
    case "darwin":
      return join(home, "Library", "Application Support", APP_FOLDER);
    case "win32":
      return join(env.APPDATA || join(home, "AppData", "Roaming"), APP_FOLDER);
    default:
      return join(env.XDG_CONFIG_HOME || join(home, ".config"), APP_FOLDER);
  }
}

/** Where the daemon listens: a socket in home/run, a short path when that is too long, a pipe on Windows. */
export function endpointFor(home: string, system: Platform = currentPlatform()): string {
  const id = createHash("sha1").update(home).digest("hex").slice(0, 12);
  if (system.platform === "win32") {
    return `\\\\.\\pipe\\pp-agentd-${id}`;
  }
  const socket = join(home, "run", "agentd.sock");
  return socket.length > MAX_SOCKET_PATH
    ? join("/tmp", `pp-agent-${system.uid}`, `agentd-${id}.sock`)
    : socket;
}

export function resolveDaemonPaths(
  env: NodeJS.ProcessEnv = process.env,
  system: Platform = currentPlatform(),
): DaemonPaths {
  const home = resolveHome(env, system.platform);
  return {
    home,
    endpoint: endpointFor(home, system),
    tokenFile: join(home, "agentd.token"),
    logFile: join(home, "logs", "daemon.log"),
    agent: {
      // The app passes Electron's `getPath("documents")` folder (Windows may redirect Documents).
      workspaceDir: env.PP_AGENT_WORKSPACE || join(homedir(), "Documents", APP_FOLDER),
      agentDir: join(home, "agent"),
      sessionDir: join(home, "sessions"),
      settingsFile: join(home, "settings.json"),
      ...(env.PP_AGENT_RESOURCES ? { resourcesDir: env.PP_AGENT_RESOURCES } : {}),
    },
  };
}
