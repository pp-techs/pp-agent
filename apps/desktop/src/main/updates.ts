import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import electronUpdater from "electron-updater";
import type { UpdateDownloadedEvent, UpdateInfo } from "electron-updater";
import type { UpdateState } from "@workspace/shared";
import { translator } from "./i18n.ts";
import {
  fetchSignedFeed,
  installerSha512,
  isNewer,
  REPO,
  sha512File,
  type Feed,
} from "./update-feed.ts";

const { autoUpdater } = electronUpdater;

const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 15_000;

type Available = Extract<UpdateState, { status: "available" }>;
type Install = Available["install"];

const releaseUrl = (version: string) => `https://github.com/${REPO}/releases/tag/v${version}`;

/**
 * The release workflow stamps `ppCodeSigned` into package.json of macOS builds signed with the
 * project's Developer ID certificate. Windows installers do not need it: they update in the app
 * against a signed feed (see `update-feed.ts`).
 */
function isCodeSigned(): boolean {
  try {
    const manifest: unknown = JSON.parse(
      readFileSync(join(app.getAppPath(), "package.json"), "utf8"),
    );
    return (
      typeof manifest === "object" &&
      manifest !== null &&
      "ppCodeSigned" in manifest &&
      manifest.ppCodeSigned === true
    );
  } catch {
    return false;
  }
}

/**
 * Windows replaces itself: the feed is signed, so a release that was replaced on GitHub cannot
 * install here, with or without a code-signing certificate. macOS only does when the build is
 * Developer ID signed (Squirrel installs only a signed bundle). Linux and `.deb` installs open the
 * release page: AppImage updates are not signed, and the `.deb` belongs to the package manager.
 */
function installMode(): Install {
  if (process.platform === "win32") return "in-app";
  if (process.platform === "darwin") return isCodeSigned() ? "in-app" : "download-page";
  return "download-page";
}

/** Latest published (non-prerelease) version, from the GitHub Releases API. */
async function fetchLatestVersion(): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `PP-Agent/${app.getVersion()}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const body: unknown = await response.json();
  const tag = typeof body === "object" && body && "tag_name" in body ? body.tag_name : null;
  const match = typeof tag === "string" ? /^v(\d+\.\d+\.\d+)$/.exec(tag) : null;
  if (!match) throw new Error("Unexpected release tag");
  return match[1]!;
}

export interface Updater {
  state(): UpdateState;
  /** Starts the periodic background check. No-op in development. */
  start(): void;
  /** `manual` checks report failures to the person; background ones stay quiet. */
  check(manual: boolean): Promise<void>;
  /** Downloads the update in the app, or opens its release page when it cannot install itself. */
  download(openExternal: (url: string) => Promise<void>): Promise<void>;
  /** Quits into the installer; `beginQuit` runs first so closing the windows cannot be vetoed. */
  install(beginQuit: () => void): void;
}

export function createUpdater(onState: (state: UpdateState) => void): Updater {
  const currentVersion = app.getVersion();
  const enabled = app.isPackaged;
  const mode = installMode();
  let state: UpdateState = { currentVersion, status: enabled ? "idle" : "disabled" };
  /** What a quiet failure falls back to. */
  let settled: UpdateState = state;
  let manualCheck = false;
  /** The feed this check verified; only the installer hash from it may install. */
  let signedFeed: Feed | null = null;
  let expectedInstallerSha512: string | null = null;

  function set(next: UpdateState): void {
    state = next;
    if (next.status === "idle" || next.status === "up-to-date" || next.status === "available") {
      settled = next;
    }
    onState(next);
  }

  function fail(error: unknown): void {
    console.error("[updates]", error);
    if (manualCheck)
      set({ currentVersion, status: "error", message: translator()("updates.checkFailed") });
    else set(settled);
  }

  function offer(version: string): void {
    set({
      currentVersion,
      status: "available",
      version,
      install: mode,
      releaseUrl: releaseUrl(version),
    });
  }

  if (enabled && mode === "in-app") {
    autoUpdater.autoDownload = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.on("update-available", (info: UpdateInfo) => {
      // The updater reads the release over its own connection. A version other than the one this
      // check verified was not signed, so it must not be offered.
      if (signedFeed !== null && info.version !== signedFeed.version) {
        fail(
          new Error(
            `The updater offered ${info.version}, the signed feed has ${signedFeed.version}`,
          ),
        );
        return;
      }
      offer(info.version);
    });
    autoUpdater.on("update-not-available", () => set({ currentVersion, status: "up-to-date" }));
    autoUpdater.on("download-progress", (progress) => {
      const version = state.status === "downloading" ? state.version : "";
      set({
        currentVersion,
        status: "downloading",
        version,
        percent: Math.round(progress.percent),
      });
    });
    autoUpdater.on("update-downloaded", (info: UpdateDownloadedEvent) => void downloaded(info));
    // Without a listener an updater error would be thrown as an uncaught exception.
    autoUpdater.on("error", (error) => {
      if (state.status === "error") return;
      if (state.status === "downloading") {
        console.error("[updates]", error);
        set({
          currentVersion,
          status: "error",
          message: translator()("updates.downloadFailed"),
        });
      } else {
        fail(error);
      }
    });
  }

  /** Compares the bytes that are about to install with the feed whose signature was verified. */
  async function downloaded(info: UpdateDownloadedEvent): Promise<void> {
    const version = signedFeed?.version ?? info.version;
    if (expectedInstallerSha512 !== null) {
      let actual: string;
      try {
        actual = await sha512File(info.downloadedFile);
      } catch (error) {
        fail(error);
        return;
      }
      if (actual !== expectedInstallerSha512) {
        console.error("[updates] the downloaded installer does not match the signed feed");
        set({ currentVersion, status: "error", message: translator()("updates.downloadFailed") });
        return;
      }
    }
    set({ currentVersion, status: "ready", version });
  }

  async function check(manual: boolean): Promise<void> {
    if (!enabled) return;
    if (state.status === "checking" || state.status === "downloading" || state.status === "ready")
      return;
    manualCheck = manual;
    signedFeed = null;
    expectedInstallerSha512 = null;
    set({ currentVersion, status: "checking" });
    try {
      if (mode === "in-app") {
        if (process.platform === "win32") {
          // The updater trusts whatever feed it reads; verify the signature here before it runs.
          let feed: Feed;
          try {
            feed = await fetchSignedFeed(`PP-Agent/${currentVersion}`);
            if (!isNewer(feed.version, currentVersion)) {
              set({ currentVersion, status: "up-to-date" });
              return;
            }
            signedFeed = feed;
            expectedInstallerSha512 = installerSha512(feed, ".exe");
          } catch (error) {
            fail(error);
            return;
          }
        }
        await autoUpdater.checkForUpdates();
      } else {
        const latest = await fetchLatestVersion();
        if (isNewer(latest, currentVersion)) offer(latest);
        else set({ currentVersion, status: "up-to-date" });
      }
    } catch (error) {
      // In-app errors were already handled by the updater's `error` listener.
      if (mode !== "in-app") fail(error);
    }
  }

  return {
    state: () => state,
    start() {
      if (!enabled) return;
      setTimeout(() => void check(false), FIRST_CHECK_DELAY_MS).unref();
      setInterval(() => void check(false), CHECK_INTERVAL_MS).unref();
    },
    check,
    async download(openExternal) {
      if (state.status !== "available") return;
      if (state.install === "download-page") {
        await openExternal(state.releaseUrl);
        return;
      }
      set({ currentVersion, status: "downloading", version: state.version, percent: 0 });
      // Failures arrive through the `error` listener.
      await autoUpdater.downloadUpdate().catch(() => undefined);
    },
    install(beginQuit: () => void) {
      if (state.status !== "ready") return;
      // quitAndInstall closes the app's windows itself and quits only once they are all closed.
      // The window must not veto that close (hide to tray), or the update never installs and the
      // app never restarts.
      beginQuit();
      autoUpdater.quitAndInstall();
    },
  };
}
