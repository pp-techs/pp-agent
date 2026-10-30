import type { DesktopBridge } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { PauseIcon, PlayIcon, TargetIcon, XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { goalStatusKey } from "@/lib/goal";
import { useAgentCommands, useGoalPending } from "@/lib/queries";
import { useChatStore } from "@/stores/chat-store";

/** The open conversation's goal above the message box, with pause/resume and clear. */
export function GoalBanner({ bridge }: { bridge: DesktopBridge }) {
  const goal = useChatStore((state) => state.goal);
  const { setGoal } = useAgentCommands(bridge);
  const pending = useGoalPending();
  const { t } = useTranslation("chat");
  if (!goal) return null;

  const paused = goal.status === "paused";
  const toggle = paused ? t("goal.resume") : t("goal.pause");
  const onError = (error: Error) => toast.error(error.message);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-2">
      <div
        role="status"
        className="flex items-center gap-2 rounded-2xl border bg-muted/40 py-1.5 pr-1.5 pl-3 text-sm"
      >
        <TargetIcon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate" title={goal.objective}>
            {goal.objective}
          </p>
          <p className="text-xs text-muted-foreground">{t(goalStatusKey(goal))}</p>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={toggle}
                disabled={pending}
                onClick={() => setGoal.mutate({ action: paused ? "resume" : "pause" }, { onError })}
              />
            }
          >
            {paused ? <PlayIcon /> : <PauseIcon />}
          </TooltipTrigger>
          <TooltipContent>{toggle}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("goal.clear")}
                disabled={pending}
                onClick={() => setGoal.mutate({ action: "clear" }, { onError })}
              />
            }
          >
            <XIcon />
          </TooltipTrigger>
          <TooltipContent>{t("goal.clear")}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
