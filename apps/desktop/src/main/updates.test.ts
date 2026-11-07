import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";

const quitAndInstall = vi.hoisted(() => vi.fn());
const handlers = vi.hoisted(() => new Map<string, (event: unknown) => void>());
/** The app folder whose package.json the updater reads for the release workflow's signed flag. */
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
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall,
    },
  },
}));
vi.mock("./i18n.ts", () => ({ translator: () => (key: string) => key }));

// Windows installs in-app only when the release workflow signed the build.
Object.defineProperty(process, "platform", { value: "win32" });

const { createUpdater } = await import("./updates.ts");

function appFolder(manifest: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "pp-updates-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
  return dir;
}

describe("signed builds", () => {
  function readyUpdater() {
    appPath.current = appFolder({ ppCodeSigned: true });
    handlers.clear();
    const updater = createUpdater(() => {});
    handlers.get("update-downloaded")!({ version: "2.0.0" });
    return updater;
  }

  it("marks the app as quitting before the updater starts closing its windows", () => {
    quitAndInstall.mockClear();
    // quitAndInstall closes the windows itself; a window that hides to the tray instead of closing
    // would keep the app alive and the update would never install or restart the app.
    const beginQuit = vi.fn();
    readyUpdater().install(beginQuit);
    expect(beginQuit).toHaveBeenCalledOnce();
    expect(quitAndInstall).toHaveBeenCalledOnce();
    expect(beginQuit.mock.invocationCallOrder[0]).toBeLessThan(
      quitAndInstall.mock.invocationCallOrder[0]!,
    );
  });

  it("does not quit the app while no update is ready to install", () => {
    quitAndInstall.mockClear();
    appPath.current = appFolder({ ppCodeSigned: true });
    const beginQuit = vi.fn();
    createUpdater(() => {}).install(beginQuit);
    expect(beginQuit).not.toHaveBeenCalled();
    expect(quitAndInstall).not.toHaveBeenCalled();
  });
});

it("sends unsigned Windows builds to the release page instead of installing", async () => {
  appPath.current = appFolder({ name: "@workspace/desktop" });
  handlers.clear();
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify({ tag_name: "v2.0.0" }), { status: 200 }));
  const updater = createUpdater(() => {});
  // No in-app updater is wired up for an unsigned build.
  expect(handlers.size).toBe(0);
  await updater.check(true);
  expect(updater.state()).toMatchObject({ status: "available", install: "download-page" });
  fetchMock.mockRestore();
});
