import { open, readdir, readFile, realpath, stat } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import type { FilePreview, WorkspaceEntry } from "@workspace/shared";

import { t } from "./i18n.ts";
import { isInside } from "./office/files.ts";

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

/**
 * The absolute path of `path` (relative, `/`-separated) inside the workspace `root`, for a phone
 * reading the computer's files. Symbolic links are resolved first, so a link cannot lead out of
 * the workspace, and the app's own data folder (keys, tokens) is never read, even when it is a
 * workspace.
 */
async function resolveInside(
  root: string,
  path: string,
  denied: readonly string[],
): Promise<{ file: string; root: string }> {
  if (typeof path !== "string" || path.includes("\0"))
    throw new Error(t("panel.files.outsideWorkspace"));
  const realRoot = await realpath(root);
  let file: string;
  try {
    file = await realpath(join(realRoot, ...path.split("/").filter(Boolean)));
  } catch {
    throw new Error(t("panel.files.notFound"));
  }
  if (!isInside(realRoot, file)) throw new Error(t("panel.files.outsideWorkspace"));
  for (const folder of denied) {
    const real = await realpath(folder).catch(() => folder);
    if (isInside(real, file)) throw new Error(t("panel.files.outsideWorkspace"));
  }
  return { file, root: realRoot };
}

/** One folder of a workspace: its entries, folders first. */
export async function listWorkspaceFolder(
  root: string,
  dir: string,
  denied: readonly string[],
): Promise<WorkspaceEntry[]> {
  const { file: folder, root: realRoot } = await resolveInside(root, dir, denied);
  if (!(await stat(folder)).isDirectory()) throw new Error(t("panel.files.notFound"));
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

/** Folders of installed dependencies and build output: thousands of files nobody looks for by name. */
const SEARCH_SKIPPED = new Set([
  "node_modules",
  ".venv",
  "__pycache__",
  ".next",
  ".turbo",
  ".cache",
  "dist",
  "build",
]);
const MAX_RESULTS = 100;
/** Entries looked at before the search gives up on a very large workspace. */
const MAX_VISITED = 20_000;

/**
 * The files of the workspace `root` whose path holds every word of `query` (any case), folders
 * nearest to the top first; a match in the file's own name ranks above one in a folder's name.
 * Symbolic links are not followed, so the search cannot leave the workspace, and the app's own data
 * folder is never searched.
 */
export async function searchWorkspaceFiles(
  root: string,
  query: string,
  denied: readonly string[],
): Promise<WorkspaceEntry[]> {
  const terms = query.slice(0, 200).toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const realRoot = await realpath(root);
  const deniedRoots = await Promise.all(
    denied.map((folder) => realpath(folder).catch(() => folder)),
  );
  const found: { path: string; name: string; inName: boolean }[] = [];
  const folders = [""];
  let visited = 0;
  for (let next = 0; next < folders.length && visited < MAX_VISITED; next++) {
    const dir = folders[next];
    const children = await readdir(join(realRoot, dir), { withFileTypes: true }).catch(() => []);
    for (const child of children) {
      if (HIDDEN.has(child.name)) continue;
      visited++;
      const path = dir ? `${dir}/${child.name}` : child.name;
      if (child.isDirectory()) {
        const folder = join(realRoot, path);
        if (
          !SEARCH_SKIPPED.has(child.name) &&
          !deniedRoots.some((denied) => isInside(denied, folder))
        )
          folders.push(path);
      } else if (child.isFile()) {
        const lower = path.toLowerCase();
        if (!terms.every((term) => lower.includes(term))) continue;
        const name = child.name.toLowerCase();
        found.push({ path, name: child.name, inName: terms.every((term) => name.includes(term)) });
      }
    }
  }
  found.sort((a, b) => Number(b.inName) - Number(a.inName) || a.path.length - b.path.length);
  const entries = await Promise.all(
    found.slice(0, MAX_RESULTS).map(async ({ path, name }): Promise<WorkspaceEntry | null> => {
      try {
        const info = await stat(join(realRoot, path));
        return { name, path, kind: "file", size: info.size, modified: info.mtimeMs };
      } catch {
        // Removed meanwhile.
        return null;
      }
    }),
  );
  return entries.filter((entry): entry is WorkspaceEntry => entry !== null);
}

/** A file of a workspace as text, an image, or neither (too large, or not text). */
export async function previewWorkspaceFile(
  root: string,
  path: string,
  denied: readonly string[],
): Promise<FilePreview> {
  const { file } = await resolveInside(root, path, denied);
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
