import { copyFile, mkdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { resizeImage } from "@earendil-works/pi-coding-agent";
import { ATTACHMENTS_DIR, type Attachment } from "@workspace/shared";

interface ImageContent {
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

/**
 * Turns the composer's attachments into what the model receives: images inline, other files copied
 * into the workspace and listed in a block appended to the message so the agent can open them.
 */
export async function buildPrompt(
  text: string,
  attachments: Attachment[],
  workspaceDir: string,
): Promise<{ text: string; images: ImageContent[] }> {
  const images: ImageContent[] = [];
  const files: string[] = [];
  const stamp = timestamp(new Date());

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
    if (!attachment.path) throw new Error(`${attachment.name} has no file to copy.`);
    const relative = `${ATTACHMENTS_DIR}/${stamp}-${basename(attachment.name)}`;
    await mkdir(join(workspaceDir, ATTACHMENTS_DIR), { recursive: true });
    await copyFile(attachment.path, join(workspaceDir, relative));
    files.push(relative);
  }

  if (files.length === 0) return { text, images };
  const list = files.map((path) => `- ${path}`).join("\n");
  return { text: `${text}\n\n${OPEN_TAG}\n${list}\n${CLOSE_TAG}`, images };
}

/** Splits a stored user message back into the person's text and the files they attached. */
export function splitAttachedFiles(text: string): {
  text: string;
  files: Array<{ name: string; path: string }>;
} {
  const start = text.lastIndexOf(`\n\n${OPEN_TAG}\n`);
  if (start === -1 || !text.trimEnd().endsWith(CLOSE_TAG)) return { text, files: [] };
  const block = text.slice(start + OPEN_TAG.length + 3, text.lastIndexOf(CLOSE_TAG));
  const files = block
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => {
      const path = line.slice(2).trim();
      return { path, name: basename(path).replace(COPY_PREFIX, "") };
    });
  return { text: text.slice(0, start), files };
}
