import { execFile, spawn } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { OpenerApp } from "@workspace/shared";
import { type BrowserWindow, dialog } from "electron";
import { translator } from "../i18n.ts";

/** Apps remembered for "Open with"; the least recently used one is forgotten past this. */
const MAX_APPS = 8;

function appName(path: string): string {
  return basename(path, extname(path));
}

/**
 * The apps a person picked to open workspace files with, kept in a small file of the app's data
 * folder. The renderer can only launch an app from this list, which only the system's own
 * file dialog fills, so a page can never make the app run a program of its choosing.
 */
export class Openers {
  constructor(private readonly file: string) {}

  /** Most recently used first; an app that was uninstalled meanwhile is left out. */
  async list(): Promise<OpenerApp[]> {
    let paths: unknown;
    try {
      paths = JSON.parse(await readFile(this.file, "utf8"));
    } catch {
      return [];
    }
    if (!Array.isArray(paths)) return [];
    const apps = await Promise.all(
      paths.map(async (path): Promise<OpenerApp | null> => {
        if (typeof path !== "string") return null;
        try {
          await stat(path);
          return { path, name: appName(path) };
        } catch {
          return null;
        }
      }),
    );
    return apps.filter((app): app is OpenerApp => app !== null);
  }

  /** Asks for an app with the system's file dialog and remembers it; null when cancelled. */
  async choose(window: BrowserWindow | null): Promise<OpenerApp | null> {
    const t = translator();
    const options: Electron.OpenDialogOptions = {
      title: t("files.chooseAppTitle"),
      buttonLabel: t("files.chooseButton"),
      properties: ["openFile"],
      defaultPath:
        process.platform === "darwin"
          ? "/Applications"
          : process.platform === "win32"
            ? process.env.ProgramFiles
            : undefined,
      filters:
        process.platform === "darwin"
          ? [{ name: t("files.applications"), extensions: ["app"] }]
          : process.platform === "win32"
            ? [{ name: t("files.applications"), extensions: ["exe"] }]
            : undefined,
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const path = result.canceled ? undefined : result.filePaths[0];
    if (!path) return null;
    const rest = (await this.list()).filter((app) => app.path !== path);
    await writeFile(
      this.file,
      JSON.stringify([path, ...rest.map((app) => app.path)].slice(0, MAX_APPS)),
    );
    return { path, name: appName(path) };
  }

  /** Opens `file` with one of the remembered apps, which moves to the top of the list. */
  async open(file: string, appPath: string): Promise<void> {
    const apps = await this.list();
    if (!apps.some((app) => app.path === appPath)) throw new Error(translator()("files.appGone"));
    await writeFile(
      this.file,
      JSON.stringify([
        appPath,
        ...apps.filter((app) => app.path !== appPath).map((app) => app.path),
      ]),
    );
    await launch(appPath, file);
  }
}

/** Starts the app with the file and lets it run on its own; rejects when it cannot start. */
function launch(appPath: string, file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (error: Error) =>
      reject(new Error(translator()("files.appStartFailed", { error: error.message })));
    if (process.platform === "darwin") {
      // An .app is a folder; `open -a` starts it, or brings it forward, with the file.
      execFile("open", ["-a", appPath, file], (error) => (error ? fail(error) : resolve()));
      return;
    }
    const child = spawn(appPath, [file], { detached: true, stdio: "ignore" });
    child.once("error", fail);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
