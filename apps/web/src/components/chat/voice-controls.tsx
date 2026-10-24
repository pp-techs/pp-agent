import * as React from "react";
import { VOICE_LIMITS } from "@workspace/shared";
import { InputGroupButton } from "@workspace/ui/components/input-group";
import { Spinner } from "@workspace/ui/components/spinner";
import { CheckIcon, MicIcon, XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { VoiceState } from "@/hooks/use-voice-recorder";
import { formatDuration } from "@/lib/voice-input";

/** Elapsed time of the recording. Ticks on its own so the composer does not re-render with it. */
function RecordingTimer({ startedAt }: { startedAt: number }) {
  const { t } = useTranslation("chat");
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = Math.min(Math.max(now - startedAt, 0), VOICE_LIMITS.maxDurationMs);
  const time = formatDuration(elapsed);
  const max = formatDuration(VOICE_LIMITS.maxDurationMs);
  return (
    <span
      role="timer"
      aria-label={t("composer.voice.recording", { time, max })}
      className="min-w-[4.5rem] text-sm tabular-nums"
    >
      {time}
      <span className="text-muted-foreground"> / {max}</span>
    </span>
  );
}

/** Microphone button of the message box: idle → recording with timer → writing out the text. */
export function VoiceControls({
  state,
  startedAt,
  disabled,
  onStart,
  onStop,
  onCancel,
}: {
  state: VoiceState;
  startedAt: number;
  disabled: boolean;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(["chat", "common"]);

  if (state === "idle") {
    return (
      <InputGroupButton
        variant="ghost"
        size="icon-sm"
        className="size-9 rounded-full"
        aria-label={t("composer.voice.start")}
        title={t("composer.voice.start")}
        disabled={disabled}
        onClick={onStart}
      >
        <MicIcon />
      </InputGroupButton>
    );
  }

  if (state === "recording") {
    return (
      <div className="flex items-center gap-1 rounded-full bg-background/70 py-0.5 pr-0.5 pl-3">
        <span aria-hidden className="size-2 animate-pulse rounded-full bg-destructive" />
        <RecordingTimer startedAt={startedAt} />
        <InputGroupButton
          variant="ghost"
          size="icon-sm"
          className="size-8 rounded-full"
          aria-label={t("composer.voice.cancel")}
          title={t("composer.voice.cancel")}
          onClick={onCancel}
        >
          <XIcon />
        </InputGroupButton>
        <InputGroupButton
          variant="default"
          size="icon-sm"
          className="size-8 rounded-full"
          aria-label={t("composer.voice.stop")}
          title={t("composer.voice.stop")}
          onClick={onStop}
        >
          <CheckIcon />
        </InputGroupButton>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-full bg-background/70 py-0.5 pr-0.5 pl-3"
    >
      <Spinner />
      <span className="text-sm text-muted-foreground">{t("composer.voice.transcribing")}</span>
      <InputGroupButton
        variant="ghost"
        size="icon-sm"
        className="size-8 rounded-full"
        aria-label={t("composer.voice.cancelTranscribing")}
        title={t("composer.voice.cancelTranscribing")}
        onClick={onCancel}
      >
        <XIcon />
      </InputGroupButton>
    </div>
  );
}
