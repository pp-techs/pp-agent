import { type FSWatcher, watch } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import type { Attachment, FilePreview, WorkspaceEntry } from "@workspace/shared";
import { shell } from "electron";
import { isInside, mimeTypeOf } from "../files.ts";
import { translator } from "../i18n.ts";

/** System clutter and version control internals nobody browses. */
const HIDDEN = new Set([".git", ".DS_Store", "Thumbs.db", "desktop.ini"]);
const MAX_ENTRIES = 2000;
const TEXT_PREVIEW_BYTES = 256 * 1024;
const IMAGE_PREVIEW_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};
const WATCH_DEBOUNCE_MS = 300;

/**
 * The absolute path of `path` (relative, `/`-separated) inside the workspace `root`. Symbolic links
 * are resolved first, so a link cannot lead the panel out of the workspace.
 */
export async function resolveInside(root: string, path: string): Promise<string> {
  const t = translator();
  if (typeof path !== "string" || path.includes("\0"))
    throw new Error(t("panel.files.outsideWorkspace"));
  const realRoot = await realpath(root);
  let target: string;
  try {
    target = await realpath(join(realRoot, ...path.split("/").filter(Boolean)));
  } catch {
    throw new Error(t("panel.files.notFound"));
  }
  if (!isInside(realRoot, target)) throw new Error(t("panel.files.outsideWorkspace"));
  return target;
}

export async function listEntries(root: string, dir: string): Promise<WorkspaceEntry[]> {
  const folder = await resolveInside(root, dir);
  const realRoot = await realpath(root);
  const names = (await readdir(folder)).filter((name) => !HIDDEN.has(name)).slice(0, MAX_ENTRIES);
  const entries = await Promise.all(
    names.map(async (name): Promise<WorkspaceEntry | null> => {
      try {
        const info = await stat(join(folder, name));
        return {
          name,
          path: relative(realRoot, join(folder, name)).split(sep).join("/"),
          kind: info.isDirectory() ? "folder" : "file",
          size: info.size,
          modified: info.mtimeMs,
        };
      } catch {
        // A broken link, or removed meanwhile.
        return null;
      }
    }),
  );
  return entries
    .filter((entry): entry is WorkspaceEntry => entry !== null)
    .sort(
      (a, b) =>
        Number(b.kind === "folder") - Number(a.kind === "folder") ||
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
    );
}

export async function previewFile(root: string, path: string): Promise<FilePreview> {
  const file = await resolveInside(root, path);
  const info = await stat(file);
  if (!info.isFile()) return { kind: "none", size: info.size };
  const imageType = IMAGE_TYPES[extname(file).toLowerCase()];
  if (imageType) {
    if (info.size > IMAGE_PREVIEW_BYTES) return { kind: "none", size: info.size };
    const data = await readFile(file);
    return {
      kind: "image",
      dataUrl: `data:${imageType};base64,${data.toString("base64")}`,
      size: info.size,
    };
  }
  const handle = await open(file, "r");
  try {
    const length = Math.min(info.size, TEXT_PREVIEW_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    // A NUL byte in the part read: not text.
    if (buffer.includes(0)) return { kind: "none", size: info.size };
    return {
      kind: "text",
      text: buffer.toString("utf8"),
      truncated: info.size > TEXT_PREVIEW_BYTES,
      size: info.size,
    };
  } finally {
    await handle.close();
  }
}

export async function revealEntry(root: string, path: string): Promise<void> {
  shell.showItemInFolder(await resolveInside(root, path));
}

export async function entryAttachment(root: string, path: string): Promise<Attachment> {
  const file = await resolveInside(root, path);
  if (!(await stat(file)).isFile()) throw new Error(translator()("panel.files.notAFile"));
  return { name: basename(file), mimeType: mimeTypeOf(file), path: file };
}

/** A new file or folder name: one path segment, trimmed, that no system refuses. */
function checkName(name: unknown): string {
  const t = translator();
  if (typeof name !== "string") throw new Error(t("panel.files.invalidName"));
  const trimmed = name.trim();
  const forbidden = process.platform === "win32" ? /[\\/\0<>:"|?*]/ : /[/\0]/;
  if (
    !trimmed ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.length > 255 ||
    forbidden.test(trimmed)
  )
    throw new Error(t("panel.files.invalidName"));
  return trimmed;
}

function workspacePath(realRoot: string, absolute: string): string {
  return relative(realRoot, absolute).split(sep).join("/");
}

function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

/**
 * The entry at `path` itself, not what a symbolic link points to (renaming or trashing a link must
 * not touch its target). Only its folder is resolved, so the entry stays inside the workspace.
 */
async function resolveEntry(
  root: string,
  path: string,
): Promise<{ parent: string; target: string }> {
  const t = translator();
  const parts = typeof path === "string" ? path.split("/").filter(Boolean) : [];
  const name = parts.pop();
  if (!name || name === "." || name === "..") throw new Error(t("panel.files.outsideWorkspace"));
  const parent = await resolveInside(root, parts.join("/"));
  const target = join(parent, name);
  // A name that did not split on "/" (a backslash on Windows) must not lead out of the folder.
  if (dirname(target) !== parent) throw new Error(t("panel.files.outsideWorkspace"));
  if (!(await exists(target))) throw new Error(t("panel.files.notFound"));
  return { parent, target };
}

/** Creates an empty file or folder in `dir`; returns its path relative to the workspace. */
export async function createEntry(
  root: string,
  dir: string,
  name: unknown,
  kind: unknown,
): Promise<string> {
  const t = translator();
  const entryName = checkName(name);
  if (kind !== "file" && kind !== "folder") throw new Error(t("panel.files.invalidName"));
  const parent = await resolveInside(root, dir);
  if (!(await stat(parent)).isDirectory()) throw new Error(t("panel.files.notFound"));
  const target = join(parent, entryName);
  try {
    // `wx` and a non-recursive `mkdir` fail instead of replacing what is there.
    if (kind === "file") await writeFile(target, "", { flag: "wx" });
    else await mkdir(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(t("panel.files.exists", { name: entryName }));
    throw error;
  }
  return workspacePath(await realpath(root), target);
}

/** Renames an entry within its folder; returns its new path relative to the workspace. */
export async function renameEntry(root: string, path: string, name: unknown): Promise<string> {
  const entryName = checkName(name);
  const { parent, target } = await resolveEntry(root, path);
  const renamed = join(parent, entryName);
  if (renamed === target) return workspacePath(await realpath(root), target);
  if (await exists(renamed)) {
    // The same entry under another case (a case-insensitive disk) is a rename, anything else a
    // clash. `bigint: true` avoids precision loss turning two distinct inodes into one number.
    const [source, destination] = await Promise.all([
      lstat(target, { bigint: true }),
      lstat(renamed, { bigint: true }),
    ]);
    const sameEntry =
      source.ino !== 0n && source.dev === destination.dev && source.ino === destination.ino;
    if (!sameEntry) throw new Error(translator()("panel.files.exists", { name: entryName }));
  }
  await rename(target, renamed);
  return workspacePath(await realpath(root), renamed);
}

/** Moves an entry to the system trash, so it can be restored from there. */
export async function removeEntry(root: string, path: string): Promise<void> {
  await shell.trashItem((await resolveEntry(root, path)).target);
}

/** Tells the panel when anything in the watched workspace changes, a moment after it settles. */
export class WorkspaceWatcher {
  private watcher: FSWatcher | null = null;
  private root: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly onChanged: (root: string) => void) {}

  watch(root: string | null): void {
    if (root === this.root) return;
    this.stop();
    if (root === null) return;
    this.root = root;
    try {
      this.watcher = watch(root, { recursive: true }, (_event, name) => {
        if (name && String(name).split(/[\\/]/).includes(".git")) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.onChanged(root), WATCH_DEBOUNCE_MS);
      });
      this.watcher.on("error", () => this.stop());
    } catch (error) {
      // The folder is gone or the system ran out of watches; the panel still refreshes on demand.
      console.error("Could not watch the workspace folder:", error);
      this.root = null;
    }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.watcher?.close();
    this.watcher = null;
    this.root = null;
  }
}
