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
/** Writes that never pause (a build, a long download) still refresh the panel this often. */
const WATCH_MAX_WAIT_MS = 1_000;
/**
 * Changes under these folders do not refresh the panel: version control internals, installed
 * dependencies and build output change by the thousand during an install or a build.
 */
const WATCH_IGNORED =
  /(?:^|[\\/])(?:\.git|node_modules|\.venv|__pycache__|\.next|\.turbo|\.cache|dist|build)(?:[\\/]|$)/;

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

/** Folder of the workspace that previews saved from the chat go to. */
const ARTIFACTS_DIR = "artifacts";

/** `preview-2026-11-08-142305.html` for a local date; `-2`, `-3`… are added when it is taken. */
function artifactName(now: Date, attempt: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `preview-${stamp}${attempt > 1 ? `-${attempt}` : ""}.html`;
}

/**
 * Saves an HTML preview from the chat as a new file in the workspace's `artifacts` folder (created
 * when missing); returns its path relative to the workspace. At most what the panel previews, so
 * the saved file opens whole. Never replaces a file.
 */
export async function saveArtifact(root: string, html: unknown, now = new Date()): Promise<string> {
  const t = translator();
  if (typeof html !== "string" || !html.trim()) throw new Error(t("panel.files.invalidArtifact"));
  if (Buffer.byteLength(html) > TEXT_PREVIEW_BYTES)
    throw new Error(t("panel.files.artifactTooLarge"));
  const realRoot = await realpath(root);
  await mkdir(join(realRoot, ARTIFACTS_DIR), { recursive: true });
  // A link named "artifacts" must not lead out of the workspace.
  const folder = await resolveInside(root, ARTIFACTS_DIR);
  if (!(await stat(folder)).isDirectory()) throw new Error(t("panel.files.notFound"));
  for (let attempt = 1; ; attempt++) {
    const target = join(folder, artifactName(now, attempt));
    try {
      await writeFile(target, html, { flag: "wx" });
      return workspacePath(realRoot, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt >= 100) throw error;
    }
  }
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

/**
 * Tells the panel when anything in the watched workspace changes, a moment after it settles, and
 * at least every `WATCH_MAX_WAIT_MS` while changes keep coming.
 */
export class WorkspaceWatcher {
  private watcher: FSWatcher | null = null;
  private root: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  /** When the first change not yet reported arrived. */
  private firstChangeAt = 0;

  constructor(private readonly onChanged: (root: string) => void) {}

  watch(root: string | null): void {
    if (root === this.root) return;
    this.stop();
    if (root === null) return;
    this.root = root;
    try {
      this.watcher = watch(root, { recursive: true }, (_event, name) => {
        if (name && WATCH_IGNORED.test(String(name))) return;
        const now = Date.now();
        if (this.timer === null) this.firstChangeAt = now;
        clearTimeout(this.timer ?? undefined);
        const wait = Math.min(WATCH_DEBOUNCE_MS, this.firstChangeAt + WATCH_MAX_WAIT_MS - now);
        this.timer = setTimeout(
          () => {
            this.timer = null;
            this.onChanged(root);
          },
          Math.max(0, wait),
        );
      });
      this.watcher.on("error", () => this.stop());
    } catch (error) {
      // The folder is gone or the system ran out of watches; the panel still refreshes on demand.
      console.error("Could not watch the workspace folder:", error);
      this.root = null;
    }
  }

  stop(): void {
    clearTimeout(this.timer ?? undefined);
    this.timer = null;
    this.watcher?.close();
    this.watcher = null;
    this.root = null;
  }
}
