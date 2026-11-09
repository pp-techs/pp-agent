import { setDefaultResultOrder } from "node:dns";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { AgentHost, type HostOutput } from "@workspace/agent-core";
import { rotateLog } from "./log-rotation.ts";
import { APP_SPAWN_ENV, resolveDaemonPaths } from "./paths.ts";
import { RemoteServer } from "./remote/server.ts";
import { findWebDir } from "./remote/web-dir.ts";
import { DaemonServer, ensureToken } from "./server.ts";
import { serviceControlFor } from "./service-control.ts";
import { resolveShellPath } from "./shell-path.ts";
import { createVaultBackend } from "./vault/index.ts";

// Prefer IPv4 on networks with broken IPv6 while preserving address-family fallback.
setDefaultResultOrder("ipv4first");

/** Version the clients compare with their own: set by whoever started the daemon, else package.json. */
function appVersion(): string {
  if (process.env.PP_AGENT_VERSION) return process.env.PP_AGENT_VERSION;
  try {
    // Bundled into apps/desktop/dist, or run from apps/daemon/src: the package.json is one level up.
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: unknown };
    if (typeof manifest.version === "string") return manifest.version;
  } catch {
    // Fall through to "dev".
  }
  return "dev";
}

/** How long stopping the agent (bot, chat sessions) may take before the daemon exits anyway. */
const HOST_STOP_MS = 5_000;

function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`);
}

function describe(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

/**
 * Hosts the agent until asked to stop: owns the socket, the vault, and the one `AgentHost`.
 * Resolves with the exit code: 0 when it stopped or another daemon is already running (a service
 * manager leaves a clean exit alone), 1 when it failed, so the service manager restarts it.
 */
export async function runDaemon(): Promise<number> {
  try {
    return await serve();
  } catch (error) {
    log(`pp-agentd failed: ${describe(error)}`);
    return 1;
  }
}

async function serve(): Promise<number> {
  const paths = resolveDaemonPaths();
  const version = appVersion();
  await mkdir(paths.home, { recursive: true });
  const rotated = await rotateLog(paths.logFile);
  log(`pp-agentd ${version} starting (pid ${process.pid}, home ${paths.home}).`);
  if (rotated) log(`The previous log moved to ${paths.logFile}.1.`);

  process.on("unhandledRejection", (reason) => log(`Unhandled rejection: ${describe(reason)}`));
  process.on("uncaughtException", (error) => log(`Uncaught exception: ${describe(error)}`));

  // Listening first is the single-instance guard: nothing else is opened by a second daemon.
  const stopped = Promise.withResolvers<void>();
  // Set when a client (the app quitting, or replacing an old version) asked this daemon to stop.
  let shutdownRequested = false;
  // Only an app's `spawnDaemon` sets this marker; a service or terminal daemon never has it. It is
  // sent to clients, so quitting stops a daemon left behind by an earlier app, not a service one.
  const spawnedByApp = process.env[APP_SPAWN_ENV] === "1";
  const server = new DaemonServer({
    endpoint: paths.endpoint,
    token: await ensureToken(paths.tokenFile),
    appVersion: version,
    spawnedByApp,
    onShutdown: () => {
      shutdownRequested = true;
      stopped.resolve();
    },
    log,
  });
  if ((await server.listen()) === "already-running") {
    log("Another pp-agentd is already running; exiting.");
    return 0;
  }
  log(`Listening on ${paths.endpoint}.`);

  const stop = (signal: string) => {
    log(`Received ${signal}.`);
    stopped.resolve();
  };
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));
  const service = serviceControlFor(paths);
  // Only a daemon the app spawned touches the login service: a daemon the service started (even
  // from an older service file without any marker) would stop itself by reloading its own job.
  // A service file written by an older build (a restart rule since fixed, an old version) is
  // brought up to date. This daemon holds the socket, so the service instance the reload starts
  // exits as "already running".
  const serviceRefreshed = spawnedByApp
    ? service.refreshIfOutdated().then(
        (updated) => {
          if (updated) log("Updated the login service to this version.");
        },
        (error: unknown) => log(`Could not update the login service: ${describe(error)}`),
      )
    : Promise.resolve();
  let host: AgentHost | null = null;
  let remote: RemoteServer | null = null;
  try {
    // An app started from the Dock or a service manager has the minimal PATH; MCP commands
    // such as `npx` need the login shell's. The login shell can be slow, so the vault opens meanwhile.
    const [shellPath, vault] = await Promise.all([
      resolveShellPath(),
      createVaultBackend(paths.home),
    ]);
    if (shellPath) process.env.PATH = shellPath;

    // What the host emits reaches the socket clients (the window) and the web app's devices.
    const output: HostOutput = {
      emit: (event) => {
        server.output.emit(event);
        remote?.broadcast(event);
      },
      // Sign-in pages open on the computer, where the window is.
      openUrl: (url) => server.output.openUrl(url),
    };
    remote = new RemoteServer({
      file: join(paths.home, "remote.json"),
      uploadsDir: join(paths.home, "remote-uploads"),
      webDir: () => findWebDir(),
      handle: (command) => {
        if (!host) throw new Error("The agent is still starting.");
        return host.handle(command);
      },
      emit: (event) => output.emit(event),
      appVersion: version,
      log,
    });
    host = new AgentHost({
      output,
      vault,
      service,
      browser: server.browser,
      computer: server.computer,
      remote,
    });
    server.attach(host);
    // A port another program took must not keep the agent from starting.
    remote.start().catch((error: unknown) => log(`Remote access: ${describe(error)}`));
    // A client that connects while the host is starting waits on it, as the window always did.
    host.init(paths.agent, Intl.DateTimeFormat().resolvedOptions().locale).then(
      () => log("Agent ready."),
      (error: unknown) => {
        log(`The agent could not start: ${describe(error)}`);
        server.output.emit({
          type: "error",
          message: `The agent could not start: ${error instanceof Error ? error.message : String(error)}`,
        });
      },
    );
    await stopped.promise;
  } finally {
    log("Shutting down.");
    // Stop the bot and chat sessions first; a hung shutdown must not keep the process alive.
    const grace = Promise.withResolvers<void>();
    const timer = setTimeout(grace.resolve, HOST_STOP_MS);
    await Promise.race([
      host?.dispose().catch((error: unknown) => log(describe(error))),
      grace.promise,
    ]);
    clearTimeout(timer);
    await remote?.close().catch((error: unknown) => log(describe(error)));
    await server.close();
    // The login service exited quietly while this daemon held the socket; it takes over now, so
    // scheduled tasks and the bots keep running after the app that started this daemon quits.
    if (shutdownRequested && spawnedByApp) {
      await serviceRefreshed;
      await service
        .startIfInstalled()
        .catch((error: unknown) => log(`Could not start the login service: ${describe(error)}`));
    }
  }
  return 0;
}
