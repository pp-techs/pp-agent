import * as React from "react";
import type { DesktopBridge, ThinkingLevel } from "@workspace/shared";
import { Slider } from "@workspace/ui/components/slider";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useAgentCommands } from "@/lib/queries";
import { useChatStore } from "@/stores/chat-store";

/** Width of the slider's thumb (`size-6`); the tick marks line up with the thumb's travel. */
const THUMB = "1.5rem";

/**
 * Thinking (reasoning effort) of the open conversation, as a stepped slider in the model menu,
 * from the fastest to the smartest level. Renders nothing when the model can't think; new
 * conversations start with the level picked last.
 */
export function ThinkingLevels({ bridge }: { bridge: DesktopBridge }) {
  const thinking = useChatStore((state) => state.thinking);
  const running = useChatStore((state) => state.status === "running");
  const { setThinkingLevel } = useAgentCommands(bridge);
  const { t } = useTranslation("chat");
  // Follows the thumb while it is dragged; the level is saved when it is released.
  const [dragged, setDragged] = React.useState<number | null>(null);
  // The saved level arrives from the agent: once it changes, the thumb follows it again.
  const [seen, setSeen] = React.useState(thinking.level);
  if (seen !== thinking.level) {
    setSeen(thinking.level);
    setDragged(null);
  }
  const levels = thinking.available;
  if (levels.length === 0) return null;

  const index = Math.max(0, levels.indexOf(thinking.level));
  const shown = dragged ?? index;
  const level = levels[shown] ?? thinking.level;
  const last = levels.length - 1;

  return (
    <div className="flex flex-col gap-3 border-t p-3" title={t("thinking.description")}>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{t("thinking.title")}</span>
        <span className="text-muted-foreground">{t(`thinking.levels.${level}.label`)}</span>
      </div>
      {/* One line, so the menu keeps its height whatever the level's hint says. */}
      <p className="-mt-2 truncate text-xs text-muted-foreground">
        {t(`thinking.levels.${level}.hint`)}
      </p>
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{t("thinking.faster")}</span>
          <span>{t("thinking.smarter")}</span>
        </div>
        <Slider
          aria-label={t("thinking.title")}
          min={0}
          max={last}
          step={1}
          value={shown}
          disabled={running || levels.length < 2}
          onValueChange={(value) => setDragged(value)}
          onValueCommitted={(value) => {
            const next = levels[value];
            // While an earlier pick is still being saved, the level shown is not final: send this one.
            if (!next || (next === thinking.level && !setThinkingLevel.isPending))
              return setDragged(null);
            setThinkingLevel.mutate(next as ThinkingLevel, {
              onError: (error) => {
                setDragged(null);
                toast.error(error.message);
              },
            });
          }}
        >
          {levels.map((name, step) => (
            <span
              key={name}
              aria-hidden
              className="absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/50"
              style={{ left: `calc(${THUMB} / 2 + ${step / last} * (100% - ${THUMB}))` }}
            />
          ))}
        </Slider>
      </div>
    </div>
  );
}
