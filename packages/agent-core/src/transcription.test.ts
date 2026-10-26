import { DEFAULT_LOCAL_VOICE_MODEL, VOICE_LIMITS } from "@workspace/shared";
import { describe, expect, test } from "vite-plus/test";
import {
  audioExtension,
  base64ByteLength,
  baseMimeType,
  buildTranscriptionForm,
  DEFAULT_VOICE,
  describeTranscriptionFailure,
  readVoiceSettings,
  transcriptionLanguage,
  transcriptionUrl,
  validateRecording,
  validateVoiceSettings,
} from "./transcription.ts";

describe("audio formats", () => {
  test("strips codec parameters and maps to an extension", () => {
    expect(baseMimeType("Audio/WebM;codecs=opus")).toBe("audio/webm");
    expect(audioExtension("audio/webm;codecs=opus")).toBe("webm");
    expect(audioExtension("audio/mp4")).toBe("m4a");
    expect(audioExtension("video/mp4")).toBeNull();
  });
});

describe("transcriptionUrl", () => {
  test("appends the path once", () => {
    expect(transcriptionUrl("https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1/audio/transcriptions",
    );
    expect(transcriptionUrl("https://gw.example.com/v1///")).toBe(
      "https://gw.example.com/v1/audio/transcriptions",
    );
  });
});

describe("base64ByteLength", () => {
  test("matches the decoded length", () => {
    for (const text of ["", "a", "ab", "abc", "abcd", "hello world"]) {
      const encoded = Buffer.from(text).toString("base64");
      expect(base64ByteLength(encoded)).toBe(Buffer.byteLength(text));
    }
  });
});

describe("transcriptionLanguage", () => {
  test("app language, automatic, or a code", () => {
    expect(transcriptionLanguage("app", "vi")).toBe("vi");
    expect(transcriptionLanguage("auto", "vi")).toBeUndefined();
    expect(transcriptionLanguage("de", "vi")).toBe("de");
    expect(transcriptionLanguage("app", "zh-CN")).toBeUndefined();
  });
});

describe("voice settings", () => {
  test("reading falls back field by field", () => {
    expect(readVoiceSettings(null)).toEqual(DEFAULT_VOICE);
    expect(readVoiceSettings({ providerId: "openai", model: "  ", language: "EN" })).toEqual({
      providerId: "openai",
      model: "whisper-1",
      language: "en",
    });
    expect(readVoiceSettings({ language: "english" }).language).toBe("app");
    // A model that does not fit the provider falls back to that provider's own default.
    expect(readVoiceSettings({ model: "x".repeat(VOICE_LIMITS.maxModelLength + 1) }).model).toBe(
      DEFAULT_LOCAL_VOICE_MODEL,
    );
    expect(
      readVoiceSettings({
        providerId: "openai",
        model: "x".repeat(VOICE_LIMITS.maxModelLength + 1),
      }).model,
    ).toBe("whisper-1");
    expect(readVoiceSettings({ providerId: "local", model: "/models/ggml.bin" }).model).toBe(
      "/models/ggml.bin",
    );
    expect(readVoiceSettings({ providerId: "local", model: "whisper-1" }).model).toBe(
      DEFAULT_LOCAL_VOICE_MODEL,
    );
  });

  test("saving is strict", () => {
    expect(validateVoiceSettings({ providerId: " gw-x ", model: " m ", language: "AUTO" })).toEqual(
      { providerId: "gw-x", model: "m", language: "auto" },
    );
    expect(() => validateVoiceSettings({ providerId: null, model: "", language: "app" })).toThrow();
    expect(() =>
      validateVoiceSettings({ providerId: null, model: "m", language: "klingon" }),
    ).toThrow();
    expect(validateVoiceSettings({ providerId: "local", model: "small", language: "app" })).toEqual(
      { providerId: "local", model: "small", language: "app" },
    );
    expect(() =>
      validateVoiceSettings({ providerId: "local", model: "whisper-1", language: "app" }),
    ).toThrow();
  });
});

describe("validateRecording", () => {
  const small = Buffer.from("audio").toString("base64");
  test("accepts a small supported recording", () => {
    expect(() => validateRecording(small, "audio/webm;codecs=opus", 2_000)).not.toThrow();
  });
  test("rejects bad shapes, formats, empty, oversize, and overlong recordings", () => {
    expect(() => validateRecording(1, "audio/webm", 1)).toThrow();
    expect(() => validateRecording(small, "text/plain", 1)).toThrow();
    expect(() => validateRecording("", "audio/webm", 1)).toThrow();
    const big = Buffer.alloc(VOICE_LIMITS.maxBytes + 1).toString("base64");
    expect(() => validateRecording(big, "audio/webm", 1)).toThrow();
    expect(() =>
      validateRecording(small, "audio/webm", VOICE_LIMITS.maxDurationMs + 60_000),
    ).toThrow();
  });
});

describe("buildTranscriptionForm", () => {
  test("carries file, model, format, and language", () => {
    const audio = new Uint8Array(new ArrayBuffer(3));
    const form = buildTranscriptionForm(
      audio,
      "audio/webm;codecs=opus",
      { providerId: "openai", model: "whisper-1", language: "app" },
      "vi",
    );
    const file = form.get("file");
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe("recording.webm");
    expect((file as File).type).toBe("audio/webm");
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("response_format")).toBe("json");
    expect(form.get("language")).toBe("vi");
  });

  test("automatic language sends none", () => {
    const form = buildTranscriptionForm(
      new Uint8Array(new ArrayBuffer(1)),
      "audio/mp4",
      { providerId: null, model: "m", language: "auto" },
      "en",
    );
    expect(form.has("language")).toBe(false);
  });
});

describe("describeTranscriptionFailure", () => {
  test("maps well-known statuses and quotes the service otherwise", () => {
    const rejected = describeTranscriptionFailure(401, null);
    expect(describeTranscriptionFailure(403, null)).toBe(rejected);
    expect(describeTranscriptionFailure(404, null)).not.toBe(rejected);
    expect(describeTranscriptionFailure(500, { error: { message: "boom" } })).toContain("boom");
    expect(describeTranscriptionFailure(500, { error: "plain" })).toContain("plain");
    expect(describeTranscriptionFailure(502, "html")).toContain("502");
  });
});
