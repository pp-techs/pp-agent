import { app } from "electron";
import electronUpdater from "electron-updater";
import type { UpdateInfo } from "electron-updater";
import type { UpdateState } from "@workspace/shared";
import { translator } from "./i18n.ts";

const { autoUpdater } = electronUpdater;

const REPO = "pp-techs/pp-agent";
const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 15_000;

type Available = Extract<UpdateState, { status: "available" }>;
type Install = Available["install"];

const releaseUrl = (version: string) => `https://github.com/${REPO}/releases/tag/v${version}`;

/**
 * Windows installers and Linux AppImages replace themselves. macOS builds are not signed with an
 * Apple Developer ID, which macOS requires for self-updates, and `.deb` installs belong to the
 * system package manager; for those the person downloads the new installer instead.
 */
function installMode(): Install {
  if (process.platform === "win32") return "in-app";
  if (process.platform === "linux" && process.env.APPIMAGE) return "in-app";
  return "download-page";
}

/** Compares plain `x.y.z` versions; anything else counts as not newer. */
function isNewer(candidate: string, current: string): boolean {
  const parse = (version: string) => version.split("-")[0]!.split(".").map(Number);
  const [a, b] = [parse(candidate), parse(current)];
  for (let i = 0; i < 3; i++) {
    const [x, y] = [a[i] ?? Number.NaN, b[i] ?? Number.NaN];
    if (Number.isNaN(x) || Number.isNaN(y)) return false;
    if (x !== y) return x > y;
  }
  return false;
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
  install(): void;
}

export function createUpdater(onState: (state: UpdateState) => void): Updater {
  const currentVersion = app.getVersion();
  const enabled = app.isPackaged;
  const mode = installMode();
  let state: UpdateState = { currentVersion, status: enabled ? "idle" : "disabled" };
  /** What a quiet failure falls back to. */
  let settled: UpdateState = state;
  let manualCheck = false;

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
    autoUpdater.on("update-available", (info: UpdateInfo) => offer(info.version));
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
    autoUpdater.on("update-downloaded", (info: UpdateInfo) =>
      set({ currentVersion, status: "ready", version: info.version }),
    );
    // Without a listener an updater error would be thrown as an uncaught exception.
    autoUpdater.on("error", (error) => {
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

  async function check(manual: boolean): Promise<void> {
    if (!enabled) return;
    if (state.status === "checking" || state.status === "downloading" || state.status === "ready")
      return;
    manualCheck = manual;
    set({ currentVersion, status: "checking" });
    try {
      if (mode === "in-app") {
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
    install() {
      if (state.status !== "ready") return;
      autoUpdater.quitAndInstall();
    },
  };
}
