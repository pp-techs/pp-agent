import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { resizeImage } from "@earendil-works/pi-coding-agent";
import { ATTACHMENTS_DIR, type Attachment } from "@workspace/shared";
import { t } from "./i18n.ts";

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

/** Image types the model APIs accept; anything else is attached as a file. */
const MODEL_IMAGE_TYPES: Record<string, true> = {
  "image/png": true,
  "image/jpeg": true,
  "image/gif": true,
  "image/webp": true,
};

const OPEN_TAG = "<attached_files>";
const CLOSE_TAG = "</attached_files>";
/** Copies are named `<timestamp>-<original name>` so two uploads of `report.pdf` never collide. */
const COPY_PREFIX = /^\d{8}-\d{6}-\d{3}-/;

function timestamp(date: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-` +
    pad(date.getMilliseconds(), 3)
  );
}

/** What `buildPrompt` turns a message into: text ready for the model, its images, and the absolute
 *  paths of any files it copied into the workspace (to clean up later, for a temporary chat). */
export interface BuiltPrompt {
  text: string;
  images: ImageContent[];
  copied: string[];
}

/**
 * Turns the composer's attachments into what the model receives: images inline, other files copied
 * into the workspace and listed in a block appended to the message so the agent can open them.
 */
export async function buildPrompt(
  text: string,
  attachments: Attachment[],
  workspaceDir: string,
): Promise<BuiltPrompt> {
  const images: ImageContent[] = [];
  const files: string[] = [];
  /** Absolute paths of the files copied into the workspace. */
  const copied: string[] = [];
  const stamp = timestamp(new Date());

  try {
    for (const attachment of attachments) {
      if (MODEL_IMAGE_TYPES[attachment.mimeType]) {
        const bytes = attachment.path
          ? await readFile(attachment.path)
          : Buffer.from(attachment.data ?? "", "base64");
        // Downscale large photos so they fit provider limits and do not flood the context window.
        const resized = await resizeImage(bytes, attachment.mimeType);
        images.push({
          type: "image",
          data: resized?.data ?? bytes.toString("base64"),
          mimeType: resized?.mimeType ?? attachment.mimeType,
        });
        continue;
      }
      if (!attachment.path)
        throw new Error(t("conversations.attachmentNoFile", { name: attachment.name }));
      const relative = `${ATTACHMENTS_DIR}/${stamp}-${basename(attachment.name)}`;
      await mkdir(join(workspaceDir, ATTACHMENTS_DIR), { recursive: true });
      const target = join(workspaceDir, relative);
      // Tracked before the copy settles: a failure partway through still leaves a target to clean up.
      copied.push(target);
      await copyFile(attachment.path, target);
      files.push(relative);
    }
  } catch (error) {
    // Nothing of a failed attempt stays in the workspace, including a target `copyFile` left
    // behind when it failed partway through.
    await Promise.all(copied.map((file) => rm(file, { force: true })));
    throw error;
  }

  return { text: withAttachedFiles(text, files), images, copied };
}

/** `text` followed by the block that lists workspace-relative `files`; unchanged without files. */
export function withAttachedFiles(text: string, files: readonly string[]): string {
  if (files.length === 0) return text;
  const list = files.map((path) => `- ${path}`).join("\n");
  return `${text}\n\n${OPEN_TAG}\n${list}\n${CLOSE_TAG}`;
}

/**
 * Splits a stored user message back into the person's text and the files they attached. The block
 * follows the text after a blank line, or stands alone (a `/skill:` command without other text).
 */
export function splitAttachedFiles(text: string): {
  text: string;
  files: Array<{ name: string; path: string }>;
} {
  const start = text.lastIndexOf(`${OPEN_TAG}\n`);
  const before = text.slice(0, start);
  if (
    start === -1 ||
    (before !== "" && !before.endsWith("\n\n")) ||
    !text.trimEnd().endsWith(CLOSE_TAG)
  )
    return { text, files: [] };
  const block = text.slice(start + OPEN_TAG.length + 1, text.lastIndexOf(CLOSE_TAG));
  const files = block
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => {
      const path = line.slice(2).trim();
      return { path, name: basename(path).replace(COPY_PREFIX, "") };
    });
  return { text: before.slice(0, -2), files };
}
