import { allowsPlainHttp, parseServerAddress, REMOTE_DEFAULT_PORT } from "@workspace/shared";
import { BrowserWindow, session, shell } from "electron";
import { translator } from "./i18n.ts";
import { restrictPermissions } from "./permissions.ts";

/**
 * The desktop app as a client of another computer, like the phone app: the other computer serves
 * its web app (Settings › Remote access there) and this window shows it. It has no preload, so the
 * page runs the web bridge against its own origin, pairs like a phone and keeps the device token in
 * this window's partition — the local daemon and its window are not involved.
 */

/** Keeps the other computer's storage apart from this computer's page and its sessions. */
const PARTITION = "persist:pp-agent-client";
/** How long the address check waits before calling the other computer unreachable. */
const REACH_TIMEOUT_MS = 10_000;

let clientWindow: BrowserWindow | null = null;
let partitionReady = false;

export interface ClientTarget {
  /** The other computer's origin, such as `http://192.168.1.20:47830`. */
  server: string;
  /** One-time pairing code from a QR link, or null when the address was typed without one. */
  code: string | null;
}

/**
 * Reads the address typed in Settings › Remote access: an address (`192.168.1.20:47830`), a name,
 * or the pairing link from the other computer's QR code, whose code pairs in the same step.
 */
export function readClientTarget(address: string): ClientTarget {
  const link = parseServerAddress(address, REMOTE_DEFAULT_PORT);
  if (!link) throw new Error(translator()("client.badAddress"));
  // A device token must not cross the internet in the clear, as in the phone app.
  if (!allowsPlainHttp(link.server)) throw new Error(translator()("client.httpsRequired"));
  return link;
}

/** Where the other computer's web app opens, with the pairing code in the fragment it reads. */
export function clientPageUrl(target: ClientTarget): string {
  return target.code
    ? `${target.server}/#pair=${encodeURIComponent(target.code)}`
    : `${target.server}/`;
}

/**
 * Checks that the address answers as PP Agent before a window opens on it, so a wrong address or a
 * computer with Remote access off gives a sentence instead of Chromium's error page.
 */
export async function probeClient(server: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${server}/api/session`, {
      signal: AbortSignal.timeout(REACH_TIMEOUT_MS),
    });
  } catch {
    throw new Error(translator()("client.unreachable", { server }));
  }
  if (!response.ok) throw new Error(translator()("client.unreachable", { server }));
  let answer: { paired?: unknown };
  try {
    answer = (await response.json()) as { paired?: unknown };
  } catch {
    throw new Error(translator()("client.notPpAgent", { server }));
  }
  // Something else answers on that address.
  if (typeof answer.paired !== "boolean")
    throw new Error(translator()("client.notPpAgent", { server }));
}

function createClientWindow(target: ClientTarget, url: string, icon: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 640,
    minHeight: 480,
    title: "PP Agent",
    icon,
    show: false,
    webPreferences: {
      // No preload: the page uses the web bridge, exactly as in a browser or the phone app.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      partition: PARTITION,
    },
  });
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    if (clientWindow === win) clientWindow = null;
  });
  // Links in the other computer's app open in the browser; the window never opens popups.
  win.webContents.setWindowOpenHandler(({ url: link }) => {
    if (link.startsWith("https://") || link.startsWith("http://")) void shell.openExternal(link);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, link) => {
    if (!URL.canParse(link) || new URL(link).origin !== target.server) {
      event.preventDefault();
      if (link.startsWith("https://") || link.startsWith("http://")) void shell.openExternal(link);
    }
  });
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
  void win.loadURL(url);
  return win;
}

/**
 * Opens (or reuses) the window showing another computer, after checking the address. Rejects with a
 * sentence for the person when the address is not one, or the computer cannot be reached.
 */
export async function openClientWindow(address: string, icon: string): Promise<void> {
  const target = readClientTarget(address);
  await probeClient(target.server);
  if (!partitionReady) {
    // The other computer's page is first-party PP Agent, so it may record audio and copy text, but
    // nothing else: no camera, location, notifications or screen capture.
    restrictPermissions(session.fromPartition(PARTITION), () => clientWindow);
    partitionReady = true;
  }
  const url = clientPageUrl(target);
  if (clientWindow && !clientWindow.isDestroyed()) {
    if (clientWindow.webContents.getURL() !== url) await clientWindow.loadURL(url);
    if (clientWindow.isMinimized()) clientWindow.restore();
    clientWindow.show();
    clientWindow.focus();
    return;
  }
  clientWindow = createClientWindow(target, url, icon);
}
