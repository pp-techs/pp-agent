/**
 * Voice input: sends a recording from the message box to an OpenAI-compatible
 * `/audio/transcriptions` endpoint (Whisper style). The service and key come from a provider or
 * gateway the person already connected, so the key stays in this process.
 */
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_VOICE_MODEL,
  VOICE_LIMITS,
  type VoiceProviderOption,
  type VoiceSettings,
  type VoiceView,
} from "@workspace/shared";
import { currentLanguage, t } from "./i18n.ts";
import type { SettingsStore } from "./settings-store.ts";

const REQUEST_TIMEOUT_MS = 120_000;
/** The recorder stops at the cap; this much extra covers the time it takes to flush. */
const DURATION_SLACK_MS = 5_000;
/** Pi APIs that speak the OpenAI wire format, so the same base address serves `/audio/transcriptions`. */
const OPENAI_STYLE_APIS: readonly string[] = ["openai-completions", "openai-responses"];

export const DEFAULT_VOICE: VoiceSettings = {
  providerId: null,
  model: DEFAULT_VOICE_MODEL,
  language: "app",
};

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

/** Container formats the recorder and the services handle, by MIME type (parameters stripped). */
const AUDIO_EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

/** `audio/webm;codecs=opus` → `audio/webm`. */
export function baseMimeType(mimeType: string): string {
  return (mimeType.split(";")[0] ?? "").trim().toLowerCase();
}

/** File extension for a recording, or null when the format is not supported. */
export function audioExtension(mimeType: string): string | null {
  return AUDIO_EXTENSIONS[baseMimeType(mimeType)] ?? null;
}

/** `https://host/v1` (trailing slashes ignored) → `https://host/v1/audio/transcriptions`. */
export function transcriptionUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/audio/transcriptions`;
}

/** Bytes a base64 string decodes to, without decoding it. */
export function base64ByteLength(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

/** The `language` field to send: the app's language, none (automatic), or a code; undefined = omit. */
export function transcriptionLanguage(setting: string, appLanguage: string): string | undefined {
  if (setting === "auto") return undefined;
  const code = setting === "app" ? appLanguage : setting;
  return /^[a-z]{2,3}$/.test(code) ? code : undefined;
}

/** Voice settings from untrusted input (settings.json or the UI); bad fields fall back. */
export function readVoiceSettings(raw: unknown): VoiceSettings {
  const voice: VoiceSettings = { ...DEFAULT_VOICE };
  if (typeof raw !== "object" || raw === null) return voice;
  const value = raw as Record<string, unknown>;
  if (typeof value.providerId === "string" && value.providerId.trim())
    voice.providerId = value.providerId.trim();
  if (typeof value.model === "string") {
    const model = value.model.trim();
    if (model && model.length <= VOICE_LIMITS.maxModelLength) voice.model = model;
  }
  if (typeof value.language === "string") {
    const language = value.language.trim().toLowerCase();
    if (language === "app" || language === "auto" || /^[a-z]{2,3}$/.test(language))
      voice.language = language;
  }
  return voice;
}

/** Voice settings a person typed; throws a message for the person when they do not fit. */
export function validateVoiceSettings(input: VoiceSettings): VoiceSettings {
  const model = (input.model ?? "").trim();
  if (!model) throw new Error(t("voice.errors.modelRequired"));
  if (model.length > VOICE_LIMITS.maxModelLength)
    throw new Error(t("voice.errors.modelTooLong", { max: VOICE_LIMITS.maxModelLength }));
  const language = (input.language ?? "").trim().toLowerCase();
  if (language !== "app" && language !== "auto" && !/^[a-z]{2,3}$/.test(language))
    throw new Error(t("voice.errors.languageInvalid"));
  const providerId = input.providerId?.trim() || null;
  return { providerId, model, language };
}

/** A recording sent for transcription, checked; throws a message for the person otherwise. */
export function validateRecording(data: unknown, mimeType: unknown, durationMs: unknown): void {
  if (typeof data !== "string" || typeof mimeType !== "string" || typeof durationMs !== "number")
    throw new Error(t("voice.errors.recordingInvalid"));
  if (!audioExtension(mimeType)) throw new Error(t("voice.errors.formatUnsupported"));
  const bytes = base64ByteLength(data);
  if (bytes === 0) throw new Error(t("voice.errors.empty"));
  if (bytes > VOICE_LIMITS.maxBytes)
    throw new Error(
      t("voice.errors.tooLarge", { max: Math.round(VOICE_LIMITS.maxBytes / 1_048_576) }),
    );
  if (durationMs > VOICE_LIMITS.maxDurationMs + DURATION_SLACK_MS)
    throw new Error(
      t("voice.errors.tooLong", { max: Math.round(VOICE_LIMITS.maxDurationMs / 60_000) }),
    );
}

/** Multipart body of the transcription request. */
export function buildTranscriptionForm(
  audio: Uint8Array<ArrayBuffer>,
  mimeType: string,
  settings: VoiceSettings,
  appLanguage: string,
): FormData {
  const extension = audioExtension(mimeType) ?? "webm";
  const form = new FormData();
  form.set("file", new File([audio], `recording.${extension}`, { type: baseMimeType(mimeType) }));
  form.set("model", settings.model);
  form.set("response_format", "json");
  const language = transcriptionLanguage(settings.language, appLanguage);
  if (language) form.set("language", language);
  return form;
}

/** Why the service refused, in the person's language. */
export function describeTranscriptionFailure(status: number, body: unknown): string {
  if (status === 401 || status === 403) return t("voice.errors.keyRejected");
  if (status === 404) return t("voice.errors.notSupported");
  if (status === 413)
    return t("voice.errors.tooLarge", { max: Math.round(VOICE_LIMITS.maxBytes / 1_048_576) });
  if (status === 429) return t("voice.errors.limitReached");
  const detail = errorDetail(body);
  return detail
    ? t("voice.errors.serviceFailedWith", { status, detail })
    : t("voice.errors.serviceFailed", { status });
}

/** Field `key` of a JSON object, or undefined when `value` is not one. */
function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function errorDetail(body: unknown): string | undefined {
  const error = field(body, "error");
  const message = typeof error === "string" ? error : field(error, "message");
  return typeof message === "string" && message.trim() ? message.trim().slice(0, 300) : undefined;
}

// ---------------------------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------------------------

/** First model of the provider that speaks the OpenAI wire format; it carries the base address. */
function openAiStyleModel(runtime: ModelRuntime, providerId: string): Model<Api> | undefined {
  return runtime.getModels(providerId).find((model) => OPENAI_STYLE_APIS.includes(model.api));
}

export class VoiceService {
  constructor(
    private readonly runtime: ModelRuntime,
    private readonly settings: SettingsStore,
  ) {}

  /** Connected providers and gateways with an OpenAI-style address. */
  private async options(): Promise<VoiceProviderOption[]> {
    // Refreshes the availability snapshot that `hasConfiguredAuth` reads.
    await this.runtime.getAvailable();
    return this.runtime
      .getProviders()
      .filter(
        (provider) =>
          this.runtime.hasConfiguredAuth(provider.id) &&
          openAiStyleModel(this.runtime, provider.id) !== undefined,
      )
      .map((provider) => ({ id: provider.id, name: provider.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async view(): Promise<VoiceView> {
    const config = this.settings.get().voice;
    const providers = await this.options();
    return {
      config,
      providers,
      ready: config.providerId !== null && providers.some((item) => item.id === config.providerId),
    };
  }

  async save(input: VoiceSettings): Promise<VoiceView> {
    const config = validateVoiceSettings(input);
    if (config.providerId && !(await this.options()).some((item) => item.id === config.providerId))
      throw new Error(t("voice.errors.providerUnavailable"));
    this.settings.update((draft) => {
      draft.voice = config;
    });
    return this.view();
  }

  async transcribe(data: string, mimeType: string, durationMs: number): Promise<string> {
    const config = this.settings.get().voice;
    if (!config.providerId) throw new Error(t("voice.errors.notConfigured"));
    validateRecording(data, mimeType, durationMs);
    const providerId = config.providerId;
    await this.runtime.getAvailable();
    const model = openAiStyleModel(this.runtime, providerId);
    if (!model || !this.runtime.hasConfiguredAuth(providerId))
      throw new Error(t("voice.errors.providerUnavailable"));
    const auth = await this.runtime.getAuth(model);
    if (!auth) throw new Error(t("voice.errors.providerUnavailable"));
    const baseUrl = auth.auth.baseUrl ?? model.baseUrl;

    const audio = new Uint8Array(Buffer.from(data, "base64"));
    const headers = new Headers();
    for (const [name, value] of Object.entries(auth.auth.headers ?? {})) {
      if (value !== null) headers.set(name, value);
    }
    if (auth.auth.apiKey) headers.set("Authorization", `Bearer ${auth.auth.apiKey}`);
    let response: Response;
    try {
      response = await fetch(transcriptionUrl(baseUrl), {
        method: "POST",
        headers,
        body: buildTranscriptionForm(audio, mimeType, config, currentLanguage()),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new Error(
        timedOut
          ? t("voice.errors.timedOut")
          : t("voice.errors.unreachable", {
              error: error instanceof Error ? error.message : String(error),
            }),
      );
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(describeTranscriptionFailure(response.status, body));
    const text = field(body, "text");
    if (typeof text !== "string") throw new Error(t("voice.errors.badResponse"));
    const transcript = text.trim();
    if (!transcript) throw new Error(t("voice.errors.nothingHeard"));
    return transcript;
  }
}
