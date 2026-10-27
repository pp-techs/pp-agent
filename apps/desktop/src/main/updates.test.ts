import { expect, it, vi } from "vite-plus/test";

const quitAndInstall = vi.hoisted(() => vi.fn());
const handlers = vi.hoisted(() => new Map<string, (event: unknown) => void>());

vi.mock("electron", () => ({
  app: { getVersion: () => "1.2.3", isPackaged: true, getAppPath: () => "/nonexistent" },
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

// The updater only installs in-app where the release workflow can replace the app itself.
Object.defineProperty(process, "platform", { value: "win32" });

const { createUpdater } = await import("./updates.ts");

function readyUpdater() {
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
  const beginQuit = vi.fn();
  createUpdater(() => {}).install(beginQuit);
  expect(beginQuit).not.toHaveBeenCalled();
  expect(quitAndInstall).not.toHaveBeenCalled();
});
