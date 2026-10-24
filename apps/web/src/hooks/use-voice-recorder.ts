import * as React from "react";
import { VOICE_LIMITS, type DesktopBridge } from "@workspace/shared";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  AUDIO_BITS_PER_SECOND,
  blobToBase64,
  MIN_RECORDING_MS,
  RECORDING_TYPES,
} from "@/lib/voice-input";

export type VoiceState = "idle" | "recording" | "transcribing";

/** A recording in progress: the microphone stream, the recorder, and what it has captured. */
interface Recording {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  startedAt: number;
  limitTimer: number;
}

function releaseMicrophone(recording: Recording) {
  clearTimeout(recording.limitTimer);
  recording.stream.getTracks().forEach((track) => track.stop());
}

/**
 * Records the microphone with `MediaRecorder` and turns the recording into text through the agent
 * (`transcribe_audio`, which holds the key). Recording stops by itself at the duration limit.
 * `onText` receives the text; nothing is sent to the chat.
 */
export function useVoiceRecorder(bridge: DesktopBridge, onText: (text: string) => void) {
  const { t } = useTranslation("chat");
  const [state, setState] = React.useState<VoiceState>("idle");
  const [startedAt, setStartedAt] = React.useState(0);
  const recording = React.useRef<Recording | null>(null);
  // Bumped to drop the result of a transcription that was cancelled or outlived the composer.
  const attempt = React.useRef(0);
  // True while the microphone permission or device is being opened.
  const starting = React.useRef(false);
  const mounted = React.useRef(true);
  const latest = React.useRef({ onText, t });
  React.useEffect(() => {
    latest.current = { onText, t };
  });

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      attempt.current++;
      const current = recording.current;
      recording.current = null;
      if (current) {
        current.recorder.onstop = null;
        if (current.recorder.state !== "inactive") current.recorder.stop();
        releaseMicrophone(current);
      }
    };
  }, []);

  async function transcribe(current: Recording, durationMs: number) {
    const { t: translate } = latest.current;
    const mine = ++attempt.current;
    setState("transcribing");
    try {
      if (durationMs < MIN_RECORDING_MS) {
        toast.error(translate("composer.voice.errors.tooShort"));
        return;
      }
      const blob = new Blob(current.chunks, { type: current.recorder.mimeType || "audio/webm" });
      if (blob.size > VOICE_LIMITS.maxBytes) {
        toast.error(translate("composer.voice.errors.tooLarge"));
        return;
      }
      const data = await blobToBase64(blob);
      const { text } = await bridge.agent.command({
        type: "transcribe_audio",
        data,
        mimeType: blob.type,
        durationMs,
      });
      if (mine === attempt.current) latest.current.onText(text.trim());
    } catch (error) {
      if (mine === attempt.current) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (mine === attempt.current) setState("idle");
    }
  }

  /** Ends the recording and sends it for transcription. `limitHit` marks the automatic stop. */
  async function stop(limitHit = false) {
    const current = recording.current;
    if (!current) return;
    recording.current = null;
    const durationMs = Math.min(Date.now() - current.startedAt, VOICE_LIMITS.maxDurationMs);
    const stopped = new Promise<void>((resolve) => {
      // A recorder that stopped by itself (device unplugged) has no stop event left to wait for.
      if (current.recorder.state === "inactive") resolve();
      else current.recorder.onstop = () => resolve();
    });
    if (current.recorder.state !== "inactive") current.recorder.stop();
    await stopped;
    releaseMicrophone(current);
    if (limitHit) {
      toast.info(
        latest.current.t("composer.voice.limitReached", {
          minutes: Math.round(VOICE_LIMITS.maxDurationMs / 60_000),
        }),
      );
    }
    await transcribe(current, durationMs);
  }

  function startError(error: unknown): string {
    const { t: translate } = latest.current;
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return translate("composer.voice.errors.denied");
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      return translate("composer.voice.errors.noDevice");
    }
    return translate("composer.voice.errors.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  async function start() {
    if (state !== "idle" || recording.current || starting.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error(latest.current.t("composer.voice.errors.unsupported"));
      return;
    }
    starting.current = true;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      toast.error(startError(error));
      return;
    } finally {
      starting.current = false;
    }
    if (!mounted.current) {
      // The composer went away while the permission prompt was open.
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    try {
      const mimeType = RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      const now = Date.now();
      const current: Recording = {
        recorder,
        stream,
        chunks,
        startedAt: now,
        limitTimer: window.setTimeout(() => void stop(true), VOICE_LIMITS.maxDurationMs),
      };
      recording.current = current;
      recorder.start(1_000);
      setStartedAt(now);
      setState("recording");
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      toast.error(startError(error));
    }
  }

  /** Throws the recording away (or ignores the answer of a transcription already under way). */
  function cancel() {
    attempt.current++;
    const current = recording.current;
    recording.current = null;
    if (current) {
      current.recorder.onstop = null;
      if (current.recorder.state !== "inactive") current.recorder.stop();
      releaseMicrophone(current);
    }
    setState("idle");
  }

  return { state, startedAt, start, stop: () => void stop(), cancel };
}
