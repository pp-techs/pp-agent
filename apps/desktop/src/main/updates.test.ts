import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type * as FeedModule from "./update-feed.ts";

const quitAndInstall = vi.hoisted(() => vi.fn());
const checkForUpdates = vi.hoisted(() => vi.fn());
const handlers = vi.hoisted(() => new Map<string, (event: unknown) => void>());
/** The app folder whose package.json says whether a macOS build is Developer ID signed. */
const appPath = vi.hoisted(() => ({ current: "/nonexistent" }));

vi.mock("electron", () => ({
  app: { getVersion: () => "1.2.3", isPackaged: true, getAppPath: () => appPath.current },
}));
vi.mock("electron-updater", () => ({
  default: {
    autoUpdater: {
      autoDownload: true,
      allowPrerelease: true,
      on: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
      checkForUpdates,
      downloadUpdate: vi.fn(),
      quitAndInstall,
    },
  },
}));
vi.mock("./i18n.ts", () => ({ translator: () => (key: string) => key }));
vi.mock("./update-feed.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof FeedModule>()),
  fetchSignedFeed: vi.fn(),
  sha512File: vi.fn(),
}));

const { createUpdater } = await import("./updates.ts");
const { fetchSignedFeed, sha512File } = await import("./update-feed.ts");

const signedFeed = {
  version: "2.0.0",
  files: [{ url: "pp-agent-2.0.0-win-x64.exe", sha512: "signed-hash" }],
};

function appFolder(manifest: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "pp-updates-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
  return dir;
}

beforeEach(() => {
  Object.defineProperty(process, "platform", { value: "win32" });
  handlers.clear();
  quitAndInstall.mockClear();
  checkForUpdates.mockClear();
  vi.mocked(fetchSignedFeed).mockReset();
  vi.mocked(sha512File).mockReset();
  // `fail` logs; the tests assert on the state instead.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Windows", () => {
  it("installs updates in the app without a code-signing certificate", () => {
    createUpdater(() => {});
    expect(handlers.has("update-downloaded")).toBe(true);
    expect(handlers.has("update-available")).toBe(true);
  });

  it("asks the updater only for the version the signed feed lists", async () => {
    vi.mocked(fetchSignedFeed).mockResolvedValue(signedFeed);
    const updater = createUpdater(() => {});
    await updater.check(true);
    expect(checkForUpdates).toHaveBeenCalledOnce();
    handlers.get("update-available")!({ version: "2.0.0" });
    expect(updater.state()).toMatchObject({
      status: "available",
      version: "2.0.0",
      install: "in-app",
    });
  });

  it("does not ask the updater when the signed feed has nothing new", async () => {
    vi.mocked(fetchSignedFeed).mockResolvedValue({ ...signedFeed, version: "1.2.3" });
    const updater = createUpdater(() => {});
    await updater.check(true);
    expect(checkForUpdates).not.toHaveBeenCalled();
    expect(updater.state()).toMatchObject({ status: "up-to-date" });
  });

  it("refuses an update the signed feed does not list", async () => {
    vi.mocked(fetchSignedFeed).mockResolvedValue(signedFeed);
    const updater = createUpdater(() => {});
    await updater.check(true);
    handlers.get("update-available")!({ version: "3.0.0" });
    expect(updater.state()).toMatchObject({ status: "error", message: "updates.checkFailed" });
  });

  it("installs only the installer whose hash matches the signed feed", async () => {
    vi.mocked(fetchSignedFeed).mockResolvedValue(signedFeed);
    const updater = createUpdater(() => {});
    await updater.check(true);
    handlers.get("update-available")!({ version: "2.0.0" });
    vi.mocked(sha512File).mockResolvedValue("other-hash");
    handlers.get("update-downloaded")!({ version: "2.0.0", downloadedFile: "/tmp/pp.exe" });
    await vi.waitFor(() =>
      expect(updater.state()).toMatchObject({
        status: "error",
        message: "updates.downloadFailed",
      }),
    );
    const beginQuit = vi.fn();
    updater.install(beginQuit);
    expect(beginQuit).not.toHaveBeenCalled();
    expect(quitAndInstall).not.toHaveBeenCalled();
  });

  it("marks a matching installer ready and quits into it", async () => {
    vi.mocked(fetchSignedFeed).mockResolvedValue(signedFeed);
    const updater = createUpdater(() => {});
    await updater.check(true);
    handlers.get("update-available")!({ version: "2.0.0" });
    vi.mocked(sha512File).mockResolvedValue("signed-hash");
    handlers.get("update-downloaded")!({ version: "2.0.0", downloadedFile: "/tmp/pp.exe" });
    await vi.waitFor(() =>
      expect(updater.state()).toMatchObject({ status: "ready", version: "2.0.0" }),
    );
    const beginQuit = vi.fn();
    updater.install(beginQuit);
    expect(beginQuit).toHaveBeenCalledOnce();
    expect(quitAndInstall).toHaveBeenCalledOnce();
    // quitAndInstall closes the windows itself; a window that hides to the tray instead of closing
    // would keep the app alive and the update would never install or restart the app.
    expect(beginQuit.mock.invocationCallOrder[0]).toBeLessThan(
      quitAndInstall.mock.invocationCallOrder[0]!,
    );
  });

  it("reports a signed feed that lists no Windows installer", async () => {
    vi.mocked(fetchSignedFeed).mockResolvedValue({
      version: "2.0.0",
      files: [{ url: "pp-agent-2.0.0-mac-arm64.dmg", sha512: "signed-hash" }],
    });
    const updater = createUpdater(() => {});
    await updater.check(true);
    expect(checkForUpdates).not.toHaveBeenCalled();
    expect(updater.state()).toMatchObject({ status: "error", message: "updates.checkFailed" });
  });

  it("reports a feed it cannot verify and never asks the updater", async () => {
    vi.mocked(fetchSignedFeed).mockRejectedValue(new Error("signature does not match"));
    const updater = createUpdater(() => {});
    await updater.check(true);
    expect(checkForUpdates).not.toHaveBeenCalled();
    expect(updater.state()).toMatchObject({ status: "error", message: "updates.checkFailed" });
  });

  it("stays quiet when a background check cannot verify the feed", async () => {
    vi.mocked(fetchSignedFeed).mockRejectedValue(new Error("GitHub answered 502"));
    const updater = createUpdater(() => {});
    await updater.check(false);
    expect(updater.state()).toMatchObject({ status: "idle" });
  });

  it("does not quit while no update is ready to install", () => {
    const beginQuit = vi.fn();
    createUpdater(() => {}).install(beginQuit);
    expect(beginQuit).not.toHaveBeenCalled();
    expect(quitAndInstall).not.toHaveBeenCalled();
  });
});

it("keeps macOS on the release page unless the build is Developer ID signed", () => {
  Object.defineProperty(process, "platform", { value: "darwin" });
  appPath.current = appFolder({ name: "@workspace/desktop" });
  handlers.clear();
  createUpdater(() => {});
  expect(handlers.size).toBe(0);

  appPath.current = appFolder({ ppCodeSigned: true });
  handlers.clear();
  createUpdater(() => {});
  expect(handlers.has("update-downloaded")).toBe(true);
});
