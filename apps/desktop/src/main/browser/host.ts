import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserAction, BrowserBounds, BrowserState, BrowserTab } from "@workspace/shared";
import {
  type BrowserWindow,
  type ContextMenuParams,
  clipboard,
  type Input,
  Menu,
  type MenuItemConstructorOptions,
  type Session,
  session,
  type WebContents,
  WebContentsView,
} from "electron";
import { translator } from "../i18n.ts";
import { isWebUrl, toAddress } from "./address.ts";
import { type PortableCookie, toElectronCookie } from "./cookies/portable.ts";
import type { BrowserDriver } from "./driver.ts";

/** Partition folders are `Partitions/pp-browser-<profile id>` inside the app's data folder. */
const PARTITION_PREFIX = "pp-browser-";
const MAX_TABS = 20;
/**
 * Size of a page that was never shown (the panel closed): pages lay out at their view's size, and
 * the agent's browser tool must be able to read and click one before the person opens the panel.
 */
const UNSHOWN_BOUNDS: BrowserBounds = { x: 0, y: 0, width: 1024, height: 768 };
const COOKIE_BATCH = 50;
/** Web permissions a side panel page may use; camera, location, notifications… are refused. */
const ALLOWED_PERMISSIONS = new Set(["fullscreen", "clipboard-sanitized-write", "pointerLock"]);
/** Sign-in popups (`window.open` with features) stay windows, so they can talk to their opener. */
const POPUP_OPTIONS: Electron.BrowserWindowConstructorOptions = {
  width: 520,
  height: 720,
  autoHideMenuBar: true,
  webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
};

export function partitionOf(profileId: string): string {
  return `persist:${PARTITION_PREFIX}${profileId}`;
}

/** Cmd+J (macOS) or Ctrl+J: the side panel shortcut, also while a page has the keyboard. */
export function isTogglePanelInput(input: Input): boolean {
  const modifier = process.platform === "darwin" ? input.meta : input.control;
  return (
    input.type === "keyDown" &&
    input.key.toLowerCase() === "j" &&
    modifier &&
    !input.alt &&
    !input.shift
  );
}

interface Tab {
  id: string;
  profileId: string;
  view: WebContentsView;
}

export interface BrowserHostOptions {
  /** The app's data folder, which holds the `Partitions` folder. */
  userDataDir: string;
  onState(state: BrowserState): void;
  onTogglePanel(): void;
  /** Throws a message for the person when the profile no longer exists. */
  requireProfile(profileId: string): Promise<void>;
}

/**
 * The side panel browser: one `WebContentsView` per tab, laid over the window where the renderer
 * says the page area is. Each profile is its own persistent session (cookies, storage, cache).
 */
export class BrowserHost implements BrowserDriver {
  private readonly tabs = new Map<string, Tab>();
  private readonly configured = new WeakSet<Session>();
  private activeId: string | null = null;
  private bounds: BrowserBounds | null = null;
  /** Where pages were last drawn, kept while they are hidden; new tabs start at this size. */
  private lastBounds: BrowserBounds = UNSHOWN_BOUNDS;
  private window: BrowserWindow | null = null;
  private nextId = 1;
  private emitQueued = false;

  constructor(private readonly options: BrowserHostOptions) {}

  attach(window: BrowserWindow): void {
    this.window = window;
  }

  /** The window is gone: its views go with it. */
  detach(): void {
    for (const tab of this.tabs.values()) {
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
    this.tabs.clear();
    this.activeId = null;
    this.bounds = null;
    this.window = null;
  }

  state(): BrowserState {
    return { tabs: [...this.tabs.values()].map(describe), activeId: this.activeId };
  }

  async open(profileId: string, url?: string): Promise<BrowserTab> {
    await this.options.requireProfile(profileId);
    return describe(this.openTab(profileId, url ? toAddress(url) : "about:blank", true));
  }

  async close(tabId: string): Promise<void> {
    const tab = this.requireTab(tabId);
    const order = [...this.tabs.keys()];
    const index = order.indexOf(tabId);
    this.window?.contentView.removeChildView(tab.view);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    this.tabs.delete(tabId);
    if (this.activeId === tabId) this.activeId = order[index + 1] ?? order[index - 1] ?? null;
    this.layout();
    this.emit();
  }

  async activate(tabId: string): Promise<void> {
    this.requireTab(tabId);
    this.activeId = tabId;
    this.layout();
    this.emit();
  }

  async navigate(tabId: string, input: string): Promise<void> {
    load(this.requireTab(tabId).view.webContents, toAddress(input));
  }

  async go(tabId: string, action: BrowserAction): Promise<void> {
    const contents = this.requireTab(tabId).view.webContents;
    if (action === "back") contents.navigationHistory.goBack();
    else if (action === "forward") contents.navigationHistory.goForward();
    else if (action === "reload") contents.reload();
    else contents.stop();
  }

  async evaluate(tabId: string, expression: string): Promise<unknown> {
    return this.requireTab(tabId).view.webContents.executeJavaScript(expression, true);
  }

  async screenshot(tabId: string): Promise<Buffer> {
    return (await this.requireTab(tabId).view.webContents.capturePage()).toPNG();
  }

  async setCookies(
    profileId: string,
    cookies: readonly PortableCookie[],
  ): Promise<{ written: number; refused: number }> {
    const target = this.profileSession(profileId);
    const now = Date.now() / 1000;
    let written = 0;
    let refused = 0;
    for (let start = 0; start < cookies.length; start += COOKIE_BATCH) {
      const results = await Promise.allSettled(
        cookies.slice(start, start + COOKIE_BATCH).map((cookie) => {
          const details = toElectronCookie(cookie, now);
          return details ? target.cookies.set(details) : Promise.reject(new Error("expired"));
        }),
      );
      for (const result of results) {
        if (result.status === "fulfilled") written += 1;
        else refused += 1;
      }
    }
    await target.cookies.flushStore();
    return { written, refused };
  }

  /** Where the active page is drawn; null hides every page. */
  setBounds(bounds: BrowserBounds | null): void {
    this.bounds = bounds;
    if (bounds) this.lastBounds = bounds;
    this.layout();
  }

  /** The page of a tab, for the agent's browser tool. */
  contentsOf(tabId: string): WebContents {
    const contents = this.requireTab(tabId).view.webContents;
    if (contents.isDestroyed()) throw new Error(translator()("panel.browser.tabNotFound"));
    return contents;
  }

  /**
   * Makes the tabs and the data on disk match the daemon's profile list: tabs of deleted profiles
   * close, and their partitions are cleared and removed.
   */
  async reconcile(profileIds: readonly string[]): Promise<void> {
    const known = new Set(profileIds);
    for (const tab of [...this.tabs.values()]) {
      if (!known.has(tab.profileId)) await this.close(tab.id);
    }
    const folder = join(this.options.userDataDir, "Partitions");
    const entries = await readdir(folder).catch(() => [] as string[]);
    for (const entry of entries) {
      if (!entry.startsWith(PARTITION_PREFIX)) continue;
      const profileId = entry.slice(PARTITION_PREFIX.length);
      if (known.has(profileId)) continue;
      try {
        await session.fromPartition(partitionOf(profileId)).clearStorageData();
        await session.fromPartition(partitionOf(profileId)).clearCache();
        await rm(join(folder, entry), { recursive: true, force: true });
      } catch (error) {
        console.error(`Could not remove the data of browser profile ${profileId}:`, error);
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Tabs
  // -------------------------------------------------------------------------------------------

  private requireTab(tabId: string): Tab {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error(translator()("panel.browser.tabNotFound"));
    return tab;
  }

  private openTab(profileId: string, url: string, activate: boolean): Tab {
    if (this.tabs.size >= MAX_TABS)
      throw new Error(translator()("panel.browser.tooManyTabs", { max: MAX_TABS }));
    const view = new WebContentsView({
      webPreferences: {
        partition: partitionOf(profileId),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // The agent's browser tool works on pages the panel is not showing.
        backgroundThrottling: false,
      },
    });
    this.configureSession(view.webContents.session);
    view.setBounds(this.pixelBounds(this.lastBounds));
    const tab: Tab = { id: `tab-${this.nextId++}`, profileId, view };
    this.tabs.set(tab.id, tab);
    this.wire(tab);
    view.setVisible(false);
    this.window?.contentView.addChildView(view);
    if (activate) this.activeId = tab.id;
    this.layout();
    load(view.webContents, url);
    this.emit();
    return tab;
  }

  /** A link the page or its menu opens in a new tab; past the tab limit it is only logged. */
  private openLink(tab: Tab, url: string, activate: boolean): void {
    try {
      this.openTab(tab.profileId, url, activate);
    } catch (error) {
      console.error("Could not open the link in a new tab:", error);
    }
  }

  private wire(tab: Tab): void {
    const contents = tab.view.webContents;
    guard(contents);
    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (!isWebUrl(url)) return { action: "deny" };
      if (disposition === "new-window")
        return { action: "allow", overrideBrowserWindowOptions: POPUP_OPTIONS };
      this.openLink(tab, url, disposition !== "background-tab");
      return { action: "deny" };
    });
    contents.on("did-create-window", (popup) => {
      guard(popup.webContents);
      popup.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    });
    for (const name of [
      "did-start-loading",
      "did-stop-loading",
      "did-navigate",
      "did-navigate-in-page",
      "page-title-updated",
    ] as const) {
      contents.on(name as "did-start-loading", () => this.emit());
    }
    contents.on("before-input-event", (event, input) => {
      if (!isTogglePanelInput(input)) return;
      event.preventDefault();
      this.options.onTogglePanel();
    });
    contents.on("context-menu", (_event, params) => {
      Menu.buildFromTemplate(this.contextMenu(tab, params)).popup({
        window: this.window ?? undefined,
      });
    });
  }

  private contextMenu(tab: Tab, params: ContextMenuParams): MenuItemConstructorOptions[] {
    const t = translator();
    const contents = tab.view.webContents;
    const items: MenuItemConstructorOptions[] = [];
    if (params.linkURL && isWebUrl(params.linkURL)) {
      items.push(
        {
          label: t("panel.browser.menu.openLinkInNewTab"),
          click: () => this.openLink(tab, params.linkURL, false),
        },
        {
          label: t("panel.browser.menu.copyLink"),
          click: () => clipboard.writeText(params.linkURL),
        },
        { type: "separator" },
      );
    }
    if (params.isEditable) {
      items.push(
        { label: t("panel.browser.menu.cut"), role: "cut", enabled: params.editFlags.canCut },
        { label: t("panel.browser.menu.copy"), role: "copy", enabled: params.editFlags.canCopy },
        { label: t("panel.browser.menu.paste"), role: "paste", enabled: params.editFlags.canPaste },
        { label: t("panel.browser.menu.selectAll"), role: "selectAll" },
        { type: "separator" },
      );
    } else if (params.selectionText) {
      items.push({ label: t("panel.browser.menu.copy"), role: "copy" }, { type: "separator" });
    }
    items.push(
      {
        label: t("panel.browser.menu.back"),
        enabled: contents.navigationHistory.canGoBack(),
        click: () => contents.navigationHistory.goBack(),
      },
      {
        label: t("panel.browser.menu.forward"),
        enabled: contents.navigationHistory.canGoForward(),
        click: () => contents.navigationHistory.goForward(),
      },
      { label: t("panel.browser.menu.reload"), click: () => contents.reload() },
    );
    return items;
  }

  private layout(): void {
    for (const tab of this.tabs.values()) {
      const visible = tab.id === this.activeId && this.bounds !== null;
      if (visible && this.bounds) {
        tab.view.setBounds(this.pixelBounds(this.bounds));
      } else if (tab.view.webContents.isFocused()) {
        // The keyboard would stay with a page nobody sees.
        this.window?.webContents.focus();
      }
      tab.view.setVisible(visible);
    }
  }

  private pixelBounds(bounds: BrowserBounds): Electron.Rectangle {
    return {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    };
  }

  /** Coalesces the bursts of loading events into one state update. */
  private emit(): void {
    if (this.emitQueued) return;
    this.emitQueued = true;
    queueMicrotask(() => {
      this.emitQueued = false;
      this.options.onState(this.state());
    });
  }

  // -------------------------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------------------------

  private profileSession(profileId: string): Session {
    const target = session.fromPartition(partitionOf(profileId));
    this.configureSession(target);
    return target;
  }

  private configureSession(target: Session): void {
    if (this.configured.has(target)) return;
    this.configured.add(target);
    target.setPermissionRequestHandler((_contents, permission, callback) =>
      callback(ALLOWED_PERMISSIONS.has(permission)),
    );
    target.setPermissionCheckHandler((_contents, permission) =>
      ALLOWED_PERMISSIONS.has(permission),
    );
  }
}

/** Pages may only go to web addresses (no `file:`, app schemes or `javascript:`). */
function guard(contents: WebContents): void {
  const refuse = (event: Electron.Event<{ url: string }>) => {
    if (!isWebUrl(event.url)) event.preventDefault();
  };
  contents.on("will-navigate", refuse);
  contents.on("will-redirect", refuse);
}

/** Load failures (no network, a mistyped host) show in the page; they are not errors of the app. */
function load(contents: WebContents, url: string): void {
  if (!isWebUrl(url)) return;
  contents.loadURL(url).catch(() => {});
}

function describe(tab: Tab): BrowserTab {
  const contents = tab.view.webContents;
  const destroyed = contents.isDestroyed();
  const url = destroyed ? "" : contents.getURL();
  return {
    id: tab.id,
    profileId: tab.profileId,
    url: url === "about:blank" ? "" : url,
    title: destroyed || url === "about:blank" ? "" : contents.getTitle(),
    loading: !destroyed && contents.isLoading(),
    canGoBack: !destroyed && contents.navigationHistory.canGoBack(),
    canGoForward: !destroyed && contents.navigationHistory.canGoForward(),
  };
}
