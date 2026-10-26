/**
 * Local speech to text with whisper.cpp: the person's own computer runs the model, so the
 * recording never stays between these walls and never leaves them. The daemon writes the
 * recording to a temporary file, runs `whisper-cli` on it (never through a shell, with a scrubbed
 * environment), and reads the text back. whisper.cpp reads wav, mp3 and flac itself; anything
 * else (webm/opus, ogg/opus, m4a) is turned into wav with ffmpeg first when it is installed.
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import {
  VOICE_MODEL_PRESETS,
  isVoiceModelPreset,
  type VoiceLocalStatus,
  type VoiceModelPreset,
} from "@workspace/shared";
import { t } from "./i18n.ts";
import { platformKey, resourcePath, scrubbedEnv } from "./resources.ts";

/** Wall-clock limit for one transcription run of whisper-cli or ffmpeg. */
const TIMEOUT_MS = 120_000;
/** Wall-clock limit for downloading one model; the medium file is 1.5 GB. */
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;
/** Transcript bytes kept from whisper-cli's output; a voice message is far smaller. */
const MAX_OUTPUT_BYTES = 256 * 1024;
/** Error output kept for the failure message. */
const MAX_ERROR_BYTES = 16 * 1024;
/** whisper.cpp's own model repository. */
const MODEL_BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

/** Formats whisper-cli reads as they are; every other recording goes through ffmpeg. */
const DIRECT_FORMATS: Record<string, true> = { wav: true, mp3: true, flac: true };

export function isModelFileSetting(value: string): boolean {
  return isVoiceModelPreset(value) || isAbsolute(value);
}

/** File name of a downloadable model in the app's models folder. */
export function modelFileName(preset: VoiceModelPreset): string {
  return `ggml-${preset}.bin`;
}

/** The ggml file the setting points at: a downloaded preset, or a path the person gave. */
export function modelFile(setting: string, modelsDir: string): string {
  if (isVoiceModelPreset(setting)) return join(modelsDir, modelFileName(setting));
  if (isAbsolute(setting)) return setting;
  throw new Error(t("voice.errors.localModelInvalid"));
}

/** Arguments whisper-cli is run with: transcribe the file to plain text in the given language. */
export function whisperArgs(model: string, file: string, language: string): string[] {
  return ["-m", model, "-f", file, "-l", language, "-nt", "-np"];
}

/** An executable on the PATH of `baseEnv`, or null when it is not installed. */
export function findExecutable(name: string, baseEnv: NodeJS.ProcessEnv): string | null {
  const file = process.platform === "win32" ? `${name}.exe` : name;
  for (const dir of (baseEnv.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, file);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** whisper.cpp's `whisper-cli`: bundled with the app when there is one, else on the PATH. */
export function findWhisperCli(baseEnv: NodeJS.ProcessEnv = process.env): string | null {
  const file = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
  return resourcePath("whisper", platformKey(), file) ?? findExecutable("whisper-cli", baseEnv);
}

/** What local speech to text can do right now: the executable, the downloaded models, and the
 * model the setting names. */
export function localVoiceStatus(
  model: string,
  modelsDir: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): VoiceLocalStatus {
  let modelFound = false;
  try {
    modelFound = existsSync(modelFile(model, modelsDir));
  } catch {
    modelFound = false;
  }
  const models = {} as Record<VoiceModelPreset, boolean>;
  for (const preset of VOICE_MODEL_PRESETS)
    models[preset] = existsSync(join(modelsDir, modelFileName(preset)));
  return { binary: findWhisperCli(baseEnv) !== null, models, model: modelFound };
}

/** Downloads a ggml model into the models folder; a partial download is left behind as nothing. */
export async function downloadVoiceModel(
  preset: VoiceModelPreset,
  modelsDir: string,
): Promise<string> {
  const target = join(modelsDir, modelFileName(preset));
  const part = `${target}.part`;
  await mkdir(modelsDir, { recursive: true });
  try {
    const response = await fetch(`${MODEL_BASE_URL}/${modelFileName(preset)}`, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    if (!response.body) throw new Error("the answer had no content");
    await pipeline(
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
      createWriteStream(part),
    );
    await rename(part, target);
    return target;
  } catch (error) {
    await rm(part, { force: true });
    throw new Error(
      t("voice.errors.modelDownloadFailed", {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

export interface LocalTranscriptionOptions {
  /** The recording as the person sent it. */
  audio: Uint8Array;
  /** File extension for the recording, as `audioExtension` maps the MIME type. */
  extension: string;
  /** Whisper language code, or `auto` (see `transcriptionLanguage`). */
  language: string;
  /** Folder holding the downloaded ggml models. */
  modelsDir: string;
  /** `VoiceSettings.model`: a preset name or a ggml file path. */
  model: string;
  /** Replaces the discovered executables and environment; tests only. */
  whisperCli?: string | undefined;
  ffmpeg?: string | undefined;
  baseEnv?: NodeJS.ProcessEnv | undefined;
}

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs one command with the scrubbed environment, bounded output and a wall-clock limit. */
function runCommand(
  binary: string,
  args: readonly string[],
  baseEnv: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<CommandResult> {
  const { promise, resolve, reject } = Promise.withResolvers<CommandResult>();
  const child = spawn(binary, [...args], {
    env: scrubbedEnv(baseEnv),
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let outBytes = 0;
  let errBytes = 0;
  child.stdout.on("data", (chunk: Buffer) => {
    if (outBytes < MAX_OUTPUT_BYTES) {
      stdout.push(chunk);
      outBytes += chunk.length;
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    if (errBytes < MAX_ERROR_BYTES) {
      stderr.push(chunk);
      errBytes += chunk.length;
    }
  });
  const timer = setTimeout(() => {
    child.kill("SIGKILL");
    reject(new Error(t("voice.errors.timedOut")));
  }, timeoutMs);
  child.on("error", (error) => {
    clearTimeout(timer);
    reject(new Error(t("voice.errors.localFailed", { error: error.message })));
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    resolve({
      code,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    });
  });
  return promise;
}

/**
 * Turns the recording into text with the local whisper model. Throws a message for the person
 * when whisper.cpp or the model is missing, when a foreign format needs ffmpeg that is not
 * installed, or when the run itself fails.
 */
export async function transcribeWithWhisper(options: LocalTranscriptionOptions): Promise<string> {
  const baseEnv = options.baseEnv ?? process.env;
  const binary = options.whisperCli ?? findWhisperCli(baseEnv);
  if (!binary) throw new Error(t("voice.errors.localBinaryMissing"));
  const model = modelFile(options.model, options.modelsDir);
  if (!existsSync(model)) throw new Error(t("voice.errors.localModelMissing"));

  const dir = await mkdtemp(join(tmpdir(), "pp-agent-voice-"));
  try {
    const source = join(dir, `recording.${options.extension}`);
    await writeFile(source, options.audio);
    let audioFile = source;
    if (!DIRECT_FORMATS[options.extension]) {
      const ffmpeg = options.ffmpeg ?? findExecutable("ffmpeg", baseEnv);
      if (!ffmpeg) throw new Error(t("voice.errors.localFfmpegMissing"));
      audioFile = join(dir, "recording.wav");
      const converted = await runCommand(
        ffmpeg,
        ["-loglevel", "error", "-y", "-i", source, "-ar", "16000", "-ac", "1", audioFile],
        baseEnv,
        TIMEOUT_MS,
      );
      if (converted.code !== 0)
        throw new Error(
          t("voice.errors.localFailed", {
            error: converted.stderr.trim() || `ffmpeg ${converted.code}`,
          }),
        );
    }
    const result = await runCommand(
      binary,
      whisperArgs(model, audioFile, options.language),
      baseEnv,
      TIMEOUT_MS,
    );
    if (result.code !== 0)
      throw new Error(
        t("voice.errors.localFailed", {
          error: result.stderr.trim() || `whisper-cli ${result.code}`,
        }),
      );
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
