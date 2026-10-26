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

/** The sample rate whisper works at; recordings are converted down to it. */
export const WAV_SAMPLE_RATE = 16_000;

function writeString(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/** 16-bit mono PCM WAV of the samples, at their sample rate. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const dataBytes = samples.length * 2;
  const bytes = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(bytes);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([bytes], { type: "audio/wav" });
}

/**
 * The recording as 16-bit mono WAV at `WAV_SAMPLE_RATE`: what whisper.cpp reads directly and what
 * transcription services accept too. The browser decodes whatever `MediaRecorder` produced
 * (webm/opus, ogg/opus, mp4) and resamples it into the audio context. Throws when the recording
 * cannot be decoded.
 */
export async function toWavBlob(recording: Blob): Promise<Blob> {
  const context = new AudioContext({ sampleRate: WAV_SAMPLE_RATE });
  try {
    const buffer = await context.decodeAudioData(await recording.arrayBuffer());
    const mono = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let i = 0; i < mono.length; i++) mono[i] = (mono[i] ?? 0) + (samples[i] ?? 0);
    }
    if (buffer.numberOfChannels > 1) {
      for (let i = 0; i < mono.length; i++) mono[i] = (mono[i] ?? 0) / buffer.numberOfChannels;
    }
    return encodeWav(mono, WAV_SAMPLE_RATE);
  } finally {
    void context.close();
  }
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
