import { DELEGATE_TASK_TOOL, type ChatMessage, type HelperProgress } from "@workspace/shared";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { BotIcon, ChevronDownIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { HelperStatusIcon } from "@/components/chat/helper-status";
import { useChatStore } from "@/stores/chat-store";

/** Status of the helpers of the `delegate_task` call running now, if any. */
function runningHelpers(state: { messages: ChatMessage[] }): HelperProgress[] | undefined {
  for (const message of state.messages.toReversed()) {
    for (const part of message.parts.toReversed()) {
      if (part.type === "tool" && part.name === DELEGATE_TASK_TOOL && part.status === "running")
        return part.helpers;
    }
  }
  return undefined;
}

/**
 * The sub agents working right now, pinned above the message box like the checklist, so their
 * status stays in view while the chat scrolls and when the call itself is off screen.
 */
export function HelperPanel() {
  const { t } = useTranslation("chat");
  const helpers = useChatStore(runningHelpers);
  if (!helpers?.length) return null;

  const done = helpers.filter((helper) => helper.status !== "working").length;
  const working = helpers.find((helper) => helper.status === "working");
  const current = working?.steps.at(-1);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-2">
      <Collapsible
        defaultOpen
        className="rounded-2xl border bg-muted/40 text-sm"
        aria-label={t("toolStep.helper.title")}
      >
        <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-2xl px-3 py-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <BotIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="font-medium">{t("toolStep.helper.title")}</span>
          <span className="text-xs text-muted-foreground">
            {t("toolStep.helper.progress", { done, total: helpers.length })}
          </span>
          {current && (
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground group-aria-expanded:hidden">
              · <span className="font-mono">{current.tool}</span>
              {current.target ? ` ${current.target}` : ""}
            </span>
          )}
          <ChevronDownIcon
            aria-hidden
            className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-aria-expanded:rotate-180"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto px-3 pb-2">
            {helpers.map((helper) => {
              const last = helper.steps.at(-1);
              return (
                <li key={helper.label} className="flex items-start gap-2">
                  <HelperStatusIcon status={helper.status} className="mt-0.5 size-4" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{helper.label}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t(`toolStep.helper.${helper.status}`)}
                      </span>
                    </div>
                    {helper.status === "failed" && helper.error ? (
                      <p className="truncate text-xs text-destructive">{helper.error}</p>
                    ) : last ? (
                      <p className="truncate text-xs text-muted-foreground">
                        <span className="font-mono">{last.tool}</span>
                        {last.target ? ` · ${last.target}` : ""}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
