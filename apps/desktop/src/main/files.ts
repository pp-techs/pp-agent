import { basename, extname } from "node:path";
import type { Attachment } from "@workspace/shared";
import { type BrowserWindow, dialog } from "electron";

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

export async function pickFiles(window: BrowserWindow | null): Promise<Attachment[]> {
  const options: Electron.OpenDialogOptions = {
    title: "Attach files",
    properties: ["openFile", "multiSelections"],
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled) return [];
  return result.filePaths.map((path) => ({
    name: basename(path),
    mimeType: MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
    path,
  }));
}
