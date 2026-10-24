/** Recorder formats to try, best first; the agent accepts webm, ogg, and mp4 audio. */
export const RECORDING_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

/** Roughly 0.5 MB per minute: a 5-minute recording stays far below the size limit. */
export const AUDIO_BITS_PER_SECOND = 64_000;

/** Shorter recordings are dropped: a stray click, not speech. */
export const MIN_RECORDING_MS = 400;

/**
 * Puts `text` into `draft` in place of the selection (`start` to `end`), with a space where it
 * would otherwise touch a word. `caret` is where the cursor goes: just after the inserted text.
 */
export function insertTranscript(draft: string, text: string, start: number, end: number) {
  const from = Math.max(0, Math.min(start, draft.length));
  const to = Math.max(from, Math.min(end, draft.length));
  const before = draft.slice(0, from);
  const after = draft.slice(to);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^\s/.test(after) ? " " : "";
  const inserted = `${lead}${text}${trail}`;
  return {
    draft: `${before}${inserted}${after}`,
    caret: before.length + lead.length + text.length,
  };
}

/** `83_000` → `1:23`. */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The recording as base64 (without the `data:` prefix), the shape `transcribe_audio` takes. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result;
      if (typeof url === "string") resolve(url.slice(url.indexOf(",") + 1));
      else reject(new Error("The recording could not be read."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("The recording could not be read."));
    reader.readAsDataURL(blob);
  });
}
