import type { Attachment, DesktopBridge } from "@workspace/shared";
import { create } from "zustand";

export interface DraftAttachment extends Attachment {
  id: string;
}

interface ComposerState {
  attachments: DraftAttachment[];
  add: (attachments: Attachment[]) => void;
  remove: (id: string) => void;
  clear: () => void;
  /** Puts attachments back after a failed send. */
  restore: (attachments: DraftAttachment[]) => void;
}

/** Attachments live outside the composer so files dropped anywhere on the chat land in it. */
export const useComposerStore = create<ComposerState>()((set) => ({
  attachments: [],
  add: (attachments) =>
    set((state) => ({
      attachments: [
        ...state.attachments,
        ...attachments.map((attachment) => ({ ...attachment, id: crypto.randomUUID() })),
      ],
    })),
  remove: (id) =>
    set((state) => ({ attachments: state.attachments.filter((item) => item.id !== id) })),
  clear: () => set({ attachments: [] }),
  restore: (attachments) => set({ attachments }),
}));

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

/**
 * Dropped files have a path on disk; pasted images do not, so their bytes travel inline.
 * Throws for a non-image without a path, which the agent could not open.
 */
export async function toAttachments(bridge: DesktopBridge, files: File[]): Promise<Attachment[]> {
  return Promise.all(
    files.map(async (file) => {
      const path = bridge.files.pathFor(file);
      const mimeType = file.type || "application/octet-stream";
      if (path) return { name: file.name, mimeType, path };
      if (!mimeType.startsWith("image/")) throw new Error(`Can't attach ${file.name}.`);
      const extension = mimeType.split("/")[1] ?? "png";
      return {
        name: file.name || `pasted-image.${extension}`,
        mimeType,
        data: await toBase64(file),
      };
    }),
  );
}
