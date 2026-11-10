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
