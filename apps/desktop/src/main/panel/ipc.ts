import { isAbsolute, resolve } from "node:path";
import {
  type AgentCommand,
  type BrowserAction,
  type BrowserBounds,
  type BrowserProfile,
  type BrowserRequest,
  type BrowserResult,
  COOKIE_SOURCE_BROWSERS,
  type CookieImportResult,
  type CookieSourceBrowser,
  IPC,
  type TerminalSize,
} from "@workspace/shared";
import type { BrowserWindow } from "electron";
import {
  isCookieBrowserRunning,
  listCookieSites,
  listCookieSources,
  quitCookieBrowser,
  readCookies,
} from "../browser/cookies/index.ts";
import { BrowserAutomation } from "../browser/automation.ts";
import { BrowserHost } from "../browser/host.ts";
import { translator } from "../i18n.ts";
import type { DesktopSettings } from "../settings.ts";
import type { TrustedIpc } from "../trusted-ipc.ts";
import { TerminalHost } from "./terminals.ts";
import {
  createEntry,
  entryAttachment,
  listEntries,
  previewFile,
  removeEntry,
  renameEntry,
  revealEntry,
  WorkspaceWatcher,
} from "./workspace-files.ts";

const BROWSER_ACTIONS: readonly BrowserAction[] = ["back", "forward", "reload", "stop"];
/** Longest text one `terminal.write` may carry (a large paste). */
const MAX_WRITE_CHARS = 1024 * 1024;
/** Most sites one cookie import may name (a profile rarely has this many). */
const MAX_IMPORT_SITES = 5_000;

export interface SidePanelOptions {
  window(): BrowserWindow | null;
  /** `handle`/`on` that answer only the app window's page; every channel here goes through it. */
  ipc: TrustedIpc;
  command(command: AgentCommand): Promise<unknown>;
  /** The workspace folders the panel may use (`workspaceFolders`), kept current by main. */
  settings: DesktopSettings;
  userDataDir: string;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isSize(value: unknown): value is TerminalSize {
  const size = value as TerminalSize | null;
  return typeof size?.cols === "number" && typeof size.rows === "number";
}

function isBounds(value: unknown): value is BrowserBounds {
  const bounds = value as BrowserBounds | null;
  return (
    bounds !== null &&
    typeof bounds === "object" &&
    [bounds.x, bounds.y, bounds.width, bounds.height].every(
      (number) => typeof number === "number" && Number.isFinite(number),
    )
  );
}

/**
 * The side panel's main-process half: terminals, the workspace file list, and the browser. Every
 * argument from the renderer is checked here; folders must be one of the person's workspaces.
 */
export function createSidePanel(options: SidePanelOptions) {
  const { ipc } = options;
  const send = (channel: string, ...args: unknown[]) => {
    // While the app quits the window object outlives its contents.
    const contents = options.window()?.webContents;
    if (contents && !contents.isDestroyed()) contents.send(channel, ...args);
  };

  const terminals = new TerminalHost({
    onData: (id, data, seq) => send(IPC.terminalData, id, data, seq),
    onChanged: (list) => send(IPC.terminalChanged, list),
  });
  const watcher = new WorkspaceWatcher((root) => send(IPC.workspaceChanged, root));

  async function profiles(): Promise<BrowserProfile[]> {
    return (await options.command({ type: "list_browser_profiles" })) as BrowserProfile[];
  }

  async function requireProfile(profileId: unknown): Promise<string> {
    if (!isString(profileId) || !(await profiles()).some((profile) => profile.id === profileId))
      throw new Error(translator()("panel.browser.profileNotFound"));
    return profileId;
  }

  const browser = new BrowserHost({
    userDataDir: options.userDataDir,
    onState: (state) => send(IPC.browserChanged, state),
    onTogglePanel: () => send(IPC.shellTogglePanel),
    requireProfile: async (profileId) => void (await requireProfile(profileId)),
  });

  const automation = new BrowserAutomation({
    host: browser,
    profiles,
    reveal: () => send(IPC.browserReveal),
  });

  function requireWorkspace(root: unknown): string {
    if (
      !isString(root) ||
      !isAbsolute(root) ||
      !options.settings.workspaceFolders.includes(resolve(root))
    )
      throw new Error(translator()("panel.notWorkspace"));
    return resolve(root);
  }

  function requireText(value: unknown): string {
    if (!isString(value)) throw new Error(translator()("panel.files.outsideWorkspace"));
    return value;
  }

  /** A source browser and one of its profile ids, as the renderer named them. */
  function requireSource(
    source: unknown,
    sourceProfile: unknown,
  ): { known: CookieSourceBrowser; profile: string } {
    const known = COOKIE_SOURCE_BROWSERS.find((candidate) => candidate === source);
    if (!known || !isString(sourceProfile))
      throw new Error(translator()("panel.cookies.sourceNotFound", { browser: String(source) }));
    return { known, profile: sourceProfile };
  }

  ipc.handle(IPC.terminalList, () => terminals.list());
  ipc.handle(IPC.terminalCreate, (_event, cwd: unknown, size: unknown) =>
    terminals.create(requireWorkspace(cwd), isSize(size) ? size : { cols: 80, rows: 24 }),
  );
  ipc.handle(IPC.terminalBacklog, (_event, id: unknown) =>
    terminals.backlog(isString(id) ? id : ""),
  );
  ipc.handle(IPC.terminalClose, (_event, id: unknown) => terminals.close(isString(id) ? id : ""));
  ipc.on(IPC.terminalWrite, (_event, id: unknown, data: unknown) => {
    if (isString(id) && isString(data) && data.length <= MAX_WRITE_CHARS) terminals.write(id, data);
  });
  ipc.on(IPC.terminalResize, (_event, id: unknown, size: unknown) => {
    if (isString(id) && isSize(size)) terminals.resize(id, size);
  });
  ipc.on(IPC.terminalAck, (_event, id: unknown, chars: unknown) => {
    if (isString(id) && typeof chars === "number" && Number.isFinite(chars) && chars > 0)
      terminals.ack(id, chars);
  });
  ipc.on(IPC.terminalDetach, (_event, id: unknown) => {
    if (isString(id)) terminals.detach(id);
  });

  ipc.handle(IPC.workspaceList, (_event, root: unknown, dir: unknown) =>
    listEntries(requireWorkspace(root), requireText(dir)),
  );
  ipc.handle(IPC.workspacePreview, (_event, root: unknown, path: unknown) =>
    previewFile(requireWorkspace(root), requireText(path)),
  );
  ipc.handle(IPC.workspaceReveal, (_event, root: unknown, path: unknown) =>
    revealEntry(requireWorkspace(root), requireText(path)),
  );
  ipc.handle(IPC.workspaceAttachment, (_event, root: unknown, path: unknown) =>
    entryAttachment(requireWorkspace(root), requireText(path)),
  );
  ipc.handle(
    IPC.workspaceCreate,
    (_event, root: unknown, dir: unknown, name: unknown, kind: unknown) =>
      createEntry(requireWorkspace(root), requireText(dir), name, kind),
  );
  ipc.handle(IPC.workspaceRename, (_event, root: unknown, path: unknown, name: unknown) =>
    renameEntry(requireWorkspace(root), requireText(path), name),
  );
  ipc.handle(IPC.workspaceRemove, (_event, root: unknown, path: unknown) =>
    removeEntry(requireWorkspace(root), requireText(path)),
  );
  ipc.handle(IPC.workspaceWatch, (_event, root: unknown) =>
    watcher.watch(root === null ? null : requireWorkspace(root)),
  );

  ipc.handle(IPC.browserState, () => browser.state());
  // `open` checks the profile itself, as any future caller of the driver must.
  ipc.handle(IPC.browserOpen, (_event, profileId: unknown, url: unknown) =>
    browser.open(isString(profileId) ? profileId : "", isString(url) ? url : undefined, "person"),
  );
  ipc.handle(IPC.browserClose, (_event, id: unknown) => browser.close(isString(id) ? id : ""));
  ipc.handle(IPC.browserActivate, (_event, id: unknown) =>
    browser.activate(isString(id) ? id : ""),
  );
  ipc.handle(IPC.browserNavigate, (_event, id: unknown, input: unknown) =>
    browser.navigate(isString(id) ? id : "", isString(input) ? input : "", "person"),
  );
  ipc.handle(IPC.browserGo, (_event, id: unknown, action: unknown) => {
    const known = BROWSER_ACTIONS.find((candidate) => candidate === action);
    if (known) return browser.go(isString(id) ? id : "", known);
  });
  ipc.on(IPC.browserSetBounds, (_event, bounds: unknown) =>
    browser.setBounds(isBounds(bounds) ? bounds : null),
  );
  ipc.handle(IPC.browserCookieSources, () => listCookieSources());
  ipc.handle(IPC.browserCookieSourceRunning, (_event, source: unknown) => {
    const known = COOKIE_SOURCE_BROWSERS.find((candidate) => candidate === source);
    return known ? isCookieBrowserRunning(known) : false;
  });
  ipc.handle(
    IPC.browserCookieSites,
    async (_event, source: unknown, sourceProfile: unknown, quitSource: unknown) => {
      const { known, profile } = requireSource(source, sourceProfile);
      if (quitSource === true) await quitCookieBrowser(known);
      return listCookieSites(known, profile);
    },
  );
  ipc.handle(
    IPC.browserImportCookies,
    async (
      _event,
      profileId: unknown,
      source: unknown,
      sourceProfile: unknown,
      sites: unknown,
    ): Promise<CookieImportResult> => {
      const id = await requireProfile(profileId);
      const { known, profile: fromProfile } = requireSource(source, sourceProfile);
      // Only the sites the person picked, never the whole cookie jar.
      if (
        !Array.isArray(sites) ||
        sites.length === 0 ||
        sites.length > MAX_IMPORT_SITES ||
        !sites.every(isString)
      )
        throw new Error(translator()("panel.cookies.noSites"));
      const read = await readCookies(known, fromProfile, sites);
      const { written, refused } = await browser.setCookies(id, read.cookies);
      const profile = (await options.command({
        type: "record_browser_import",
        id,
        lastImport: {
          browser: known,
          sourceProfile: read.profileName,
          at: Date.now(),
          count: written,
        },
      })) as BrowserProfile;
      return { imported: written, skipped: refused + read.unreadable, profile };
    },
  );

  return {
    attach(window: BrowserWindow): void {
      browser.attach(window);
      // Cmd+W / Ctrl+W: the app decides whether it closes a file tab or the window. Stopping the
      // key here also keeps the default menu from closing the window first.
      window.webContents.on("before-input-event", (event, input) => {
        const modifier = process.platform === "darwin" ? input.meta : input.control;
        if (input.type !== "keyDown" || input.key.toLowerCase() !== "w") return;
        if (!modifier || input.alt || input.shift) return;
        // Ctrl+Win/Super+W is another shortcut.
        if (process.platform !== "darwin" && input.meta) return;
        event.preventDefault();
        send(IPC.shellCloseTab);
      });
    },
    /** The window was destroyed: its pages, shells and watch end with it. */
    windowClosed(): void {
      browser.detach();
      terminals.dispose();
      watcher.stop();
    },
    /** Clears the data of browser profiles that were deleted (after a connection or a change). */
    async syncProfiles(): Promise<void> {
      try {
        await browser.reconcile((await profiles()).map((profile) => profile.id));
      } catch (error) {
        console.error("Could not sync the browser profiles:", error);
      }
    },
    dispose(): void {
      terminals.dispose();
      watcher.stop();
    },
    /** One call of the agent's browser tool, sent by the daemon. */
    runBrowserRequest(request: BrowserRequest): Promise<BrowserResult> {
      return automation.run(request);
    },
  };
}
