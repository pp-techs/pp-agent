import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import {
  findExecutable,
  isModelFileSetting,
  modelFile,
  transcribeWithWhisper,
  whisperArgs,
} from "./voice-local.ts";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "voice-local-test-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("model files", () => {
  test("a preset resolves in the models folder, a path is kept, anything else is refused", () => {
    expect(modelFile("base", "/models")).toBe(join("/models", "ggml-base.bin"));
    expect(modelFile("/elsewhere/ggml-small.bin", "/models")).toBe("/elsewhere/ggml-small.bin");
    expect(() => modelFile("whisper-1", "/models")).toThrow();
  });

  test("only a preset or an absolute path names a local model", () => {
    expect(isModelFileSetting("tiny")).toBe(true);
    expect(isModelFileSetting("/models/ggml.bin")).toBe(true);
    expect(isModelFileSetting("whisper-1")).toBe(false);
    expect(isModelFileSetting("")).toBe(false);
  });
});

describe("whisperArgs", () => {
  test("transcribes the file to plain text in the given language", () => {
    expect(whisperArgs("/m/ggml-base.bin", "/tmp/a.wav", "vi")).toEqual([
      "-m",
      "/m/ggml-base.bin",
      "-f",
      "/tmp/a.wav",
      "-l",
      "vi",
      "-nt",
      "-np",
    ]);
  });
});

describe("findExecutable", () => {
  test("finds a program on the PATH and nothing else", async () => {
    const name = process.platform === "win32" ? "mytool.exe" : "mytool";
    await writeFile(join(dir, name), "");
    expect(findExecutable("mytool", { PATH: dir })).toBe(join(dir, name));
    expect(findExecutable("mytool", { PATH: join(dir, "not-there") })).toBeNull();
    expect(findExecutable("mytool", {})).toBeNull();
  });
});

// The doubles below are shell scripts; Windows does not run those.
describe.runIf(process.platform !== "win32")("transcribeWithWhisper", () => {
  /** A whisper-cli double that prints the arguments it was given. */
  async function stub(script: string): Promise<string> {
    const file = join(dir, "whisper-stub");
    await writeFile(file, `#!/bin/sh\n${script}\n`);
    await chmod(file, 0o755);
    return file;
  }

  test("runs whisper-cli on the recording and reads its text", async () => {
    const binary = await stub('echo "$@"');
    const model = join(dir, "ggml-base.bin");
    await writeFile(model, "model bytes");
    const text = await transcribeWithWhisper({
      audio: new Uint8Array([1, 2, 3]),
      extension: "wav",
      language: "vi",
      modelsDir: dir,
      model: "base",
      whisperCli: binary,
      baseEnv: {},
    });
    expect(text.split(" ")).toEqual(
      expect.arrayContaining(["-m", model, "-l", "vi", "-nt", "-np"]),
    );
    expect(text).toContain("-f");
  });

  test("a recording whisper cannot read is turned into wav first", async () => {
    const binary = await stub('echo "$@"');
    // The ffmpeg double logs its arguments and writes the output file it was asked for.
    const log = join(dir, "ffmpeg-calls");
    const ffmpeg = join(dir, "ffmpeg-stub");
    await writeFile(
      ffmpeg,
      `#!/bin/sh\necho "$@" >> ${log}\nfor last; do true; done\necho wav > "$last"\n`,
    );
    await chmod(ffmpeg, 0o755);
    const model = join(dir, "ggml-base.bin");
    await writeFile(model, "model bytes");
    const text = await transcribeWithWhisper({
      audio: new Uint8Array([1, 2, 3]),
      extension: "webm",
      language: "auto",
      modelsDir: dir,
      model: "base",
      whisperCli: binary,
      ffmpeg,
      baseEnv: {},
    });
    const calls = await readFile(log, "utf8");
    expect(calls).toContain("-i");
    expect(calls).toContain("recording.wav");
    expect(text).toContain("-f");
  });

  test("a model that is not there is its own message", async () => {
    const binary = await stub("echo text");
    await expect(
      transcribeWithWhisper({
        audio: new Uint8Array([1]),
        extension: "wav",
        language: "auto",
        modelsDir: dir,
        model: "medium",
        whisperCli: binary,
        baseEnv: {},
      }),
    ).rejects.toThrow(/model/i);
  });

  test("a foreign format without ffmpeg says so", async () => {
    const binary = await stub("echo text");
    const model = join(dir, "ggml-base.bin");
    await writeFile(model, "model bytes");
    await expect(
      transcribeWithWhisper({
        audio: new Uint8Array([1]),
        extension: "webm",
        language: "auto",
        modelsDir: dir,
        model: "base",
        whisperCli: binary,
        baseEnv: { PATH: join(dir, "not-there") },
      }),
    ).rejects.toThrow(/ffmpeg/i);
  });

  test("a failing run reports what the program said", async () => {
    const binary = await stub('echo "the model file is corrupt" >&2\nexit 1');
    const model = join(dir, "ggml-base.bin");
    await writeFile(model, "model bytes");
    await expect(
      transcribeWithWhisper({
        audio: new Uint8Array([1]),
        extension: "wav",
        language: "auto",
        modelsDir: dir,
        model: "base",
        whisperCli: binary,
        baseEnv: {},
      }),
    ).rejects.toThrow(/corrupt/);
  });
});
