import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { type Attachment, EXPORT_FORMATS, type ExportFormat } from "@workspace/shared";
import { type BrowserWindow, dialog, shell } from "electron";
import { translator } from "./i18n.ts";

/** Types the agent can use; anything else is attached as a generic file. */
const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
};

/** MIME type of a file the agent may receive, from its extension. */
export function mimeTypeOf(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export async function pickFiles(window: BrowserWindow | null): Promise<Attachment[]> {
  const t = translator();
  const options: Electron.OpenDialogOptions = {
    title: t("files.attachTitle"),
    properties: ["openFile", "multiSelections"],
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled) return [];
  return result.filePaths.map((path) => ({
    name: basename(path),
    mimeType: mimeTypeOf(path),
    path,
  }));
}

function skillArchives(): Electron.FileFilter {
  return { name: translator()("files.skillArchives"), extensions: ["zip", "skill"] };
}

/**
 * Picks a skill folder or a .zip/.skill archive. macOS has one dialog that allows both; Windows and
 * Linux cannot mix folders and files in one dialog, so the person first chooses which to import.
 */
export async function pickSkill(window: BrowserWindow | null): Promise<string | null> {
  const t = translator();
  let properties: Electron.OpenDialogOptions["properties"];
  if (process.platform === "darwin") {
    properties = ["openFile", "openDirectory"];
  } else {
    const choiceOptions: Electron.MessageBoxOptions = {
      type: "question",
      title: t("files.importSkillTitle"),
      message: t("files.importSkillQuestion"),
      detail: t("files.importSkillDetail"),
      buttons: [t("files.folderButton"), t("files.archiveButton"), t("files.cancelButton")],
      defaultId: 0,
      cancelId: 2,
    };
    const { response } = window
      ? await dialog.showMessageBox(window, choiceOptions)
      : await dialog.showMessageBox(choiceOptions);
    if (response === 2) return null;
    properties = response === 0 ? ["openDirectory"] : ["openFile"];
  }
  const options: Electron.OpenDialogOptions = {
    title: t("files.importSkillTitle"),
    buttonLabel: t("files.importButton"),
    properties,
    filters: properties.includes("openFile") ? [skillArchives()] : undefined,
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

/** Picks a folder, for an agent's workspace; the dialog can create one. */
export async function pickFolder(window: BrowserWindow | null): Promise<string | null> {
  const t = translator();
  const options: Electron.OpenDialogOptions = {
    title: t("files.chooseFolderTitle"),
    buttonLabel: t("files.chooseButton"),
    properties: ["openDirectory", "createDirectory"],
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

function agentFiles(): Electron.FileFilter {
  return { name: translator()("files.agentFiles"), extensions: ["json"] };
}

/** Exported agents are small; anything bigger is not one. */
const MAX_AGENT_FILE_BYTES = 1024 * 1024;

/** Picks an exported agent and returns its text. */
export async function openAgentFile(window: BrowserWindow | null): Promise<string | null> {
  const t = translator();
  const options: Electron.OpenDialogOptions = {
    title: t("files.importAgentTitle"),
    buttonLabel: t("files.importButton"),
    properties: ["openFile"],
    filters: [agentFiles()],
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  const path = result.canceled ? undefined : result.filePaths[0];
  if (!path) return null;
  if ((await stat(path)).size > MAX_AGENT_FILE_BYTES) throw new Error(t("files.agentTooLarge"));
  return readFile(path, "utf8");
}

/** Asks where to save an exported agent and writes it; false when cancelled. */
export async function saveAgentFile(
  window: BrowserWindow | null,
  suggestedName: string,
  json: string,
): Promise<boolean> {
  // Characters that are not allowed in file names on some systems are replaced.
  const name = suggestedName.replace(/[\\/:*?"<>|]/g, "-").trim() || "agent";
  const t = translator();
  const options: Electron.SaveDialogOptions = {
    title: t("files.exportAgentTitle"),
    buttonLabel: t("files.exportButton"),
    defaultPath: `${name}.json`,
    filters: [agentFiles()],
  };
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return false;
  await writeFile(result.filePath, json, "utf8");
  return true;
}

/** Exported conversations are text; this is far beyond any real chat and stops a runaway payload. */
const MAX_EXPORT_CHARS = 50 * 1024 * 1024;

/** Asks where to save an exported conversation and writes it; false when cancelled. */
export async function saveExportFile(
  window: BrowserWindow | null,
  suggestedName: string,
  format: ExportFormat,
  content: string,
): Promise<boolean> {
  if (!EXPORT_FORMATS.includes(format) || content.length > MAX_EXPORT_CHARS)
    throw new Error(translator()("app.conversationCannotExport"));
  // Characters that are not allowed in file names on some systems are replaced.
  const name = suggestedName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim() || "chat";
  const t = translator();
  const options: Electron.SaveDialogOptions = {
    title: t("files.exportConversationTitle"),
    buttonLabel: t("files.exportButton"),
    defaultPath: `${name}.${format}`,
    filters: [
      format === "md"
        ? { name: t("files.markdownFiles"), extensions: ["md"] }
        : { name: t("files.htmlFiles"), extensions: ["html"] },
    ],
  };
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return false;
  await writeFile(result.filePath, content, "utf8");
  return true;
}

/** Asks where to save the diagnostics report and writes it; false when cancelled. */
export async function saveDiagnosticsFile(
  window: BrowserWindow | null,
  suggestedName: string,
  content: string,
): Promise<boolean> {
  const t = translator();
  const options: Electron.SaveDialogOptions = {
    title: t("files.exportDiagnosticsTitle"),
    buttonLabel: t("files.exportButton"),
    defaultPath: suggestedName,
    filters: [{ name: t("files.logFiles"), extensions: ["log", "txt"] }],
  };
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return false;
  await writeFile(result.filePath, content, "utf8");
  return true;
}

/**
 * Folders macOS runs, installs or hands to an app when Finder "opens" them, instead of showing
 * what is inside (apps, installers, plug-ins, Automator workflows).
 */
const MAC_BUNDLE =
  /\.(app|appex|action|bundle|component|docktileplugin|framework|kext|mdimporter|mpkg|osax|pkg|plugin|prefpane|qlgenerator|saver|scptd|service|systemextension|wdgt|workflow|xpc)$/i;

/**
 * Opens a workspace folder in Finder / Explorer. Only folders of the person's workspaces, and never
 * a macOS bundle: `shell.openPath` would launch it, and opening must never run anything.
 */
export async function openFolder(
  dir: string,
  workspaces: readonly string[],
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (!isAbsolute(dir) || !workspaces.includes(resolve(dir)))
    throw new Error(translator()("app.folderCannotOpen"));
  // The folder a symbolic link leads to is the one that opens.
  const real = await realpath(dir).catch(() => null);
  const info = real ? await stat(real).catch(() => null) : null;
  if (!real || !info?.isDirectory()) throw new Error(translator()("app.folderMissing"));
  if (platform === "darwin" && MAC_BUNDLE.test(basename(real)))
    throw new Error(translator()("app.folderCannotOpen"));
  const error = await shell.openPath(real);
  if (error) throw new Error(error);
}

/** Whether `path` is `root` or inside it. */
export function isInside(root: string, path: string): boolean {
  const inside = relative(resolve(root), resolve(path));
  return (
    inside === "" || (inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))
  );
}
