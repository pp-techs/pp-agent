import type { DesktopBridge } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { Spinner } from "@workspace/ui/components/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { FolderOpenIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useAgentCommands } from "@/lib/queries";
import { useChatStore } from "@/stores/chat-store";

const RING_SIZE = 18;
const RING_STROKE = 2.5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** Above this share of the window, Pi is about to compact the conversation on its own. */
const WARN_AT = 0.8;

/** 1.2k, 45k, 1.0M: token counts the way model cards print them, with the language's decimal mark. */
function formatTokens(value: number, language: string) {
  const format = (amount: number, digits: number) =>
    new Intl.NumberFormat(language, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  if (value >= 1_000_000) return `${format(value / 1_000_000, 1)}M`;
  if (value >= 10_000) return `${format(Math.round(value / 1000), 0)}k`;
  if (value >= 1000) return `${format(value / 1000, 1)}k`;
  return format(value, 0);
}

/** Circular gauge of how much of the model's context window the conversation fills. */
function ContextRing({ share }: { share: number | null }) {
  const filled = share === null ? 0 : Math.min(1, share);
  return (
    <svg
      width={RING_SIZE}
      height={RING_SIZE}
      viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      aria-hidden
      className="-rotate-90"
    >
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={RING_STROKE}
        className="opacity-20"
      />
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={RING_LENGTH}
        strokeDashoffset={RING_LENGTH * (1 - filled)}
        className={filled >= WARN_AT ? "text-warning" : undefined}
      />
    </svg>
  );
}

/** Context window of the open conversation: a ring, with the numbers and "Compact" in a popover. */
function ContextButton({ bridge }: { bridge: DesktopBridge }) {
  const context = useChatStore((state) => state.context);
  const status = useChatStore((state) => state.status);
  const hasMessages = useChatStore((state) => state.messages.length > 0);
  const { compact } = useAgentCommands(bridge);
  const { t, i18n } = useTranslation("chat");
  const { language } = i18n;
  if (!context) return null;

  const share = context.tokens === null ? null : context.tokens / context.window;
  const percent = share === null ? null : Math.round(share * 100);
  const label =
    percent === null ? t("header.context.title") : t("header.context.usedLabel", { percent });
  const canCompact = status === "idle" && hasMessages && !compact.isPending;

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} />} />
          }
        >
          <ContextRing share={share} />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-64 gap-3 p-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">{t("header.context.title")}</p>
          <p className="text-sm text-muted-foreground">
            {context.tokens === null
              ? t("header.context.unknown", { window: formatTokens(context.window, language) })
              : t("header.context.used", {
                  used: formatTokens(context.tokens, language),
                  window: formatTokens(context.window, language),
                  percent,
                })}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">{t("header.context.hint")}</p>
        <Button
          variant="outline"
          size="sm"
          disabled={!canCompact}
          onClick={() =>
            compact.mutate(undefined, { onError: (error) => toast.error(error.message) })
          }
        >
          {compact.isPending && <Spinner />}
          {t("header.context.compact")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** Opens the folder the open conversation works in (its workspace's folder). */
function OpenFolderButton({ bridge }: { bridge: DesktopBridge }) {
  const workspaceDir = useChatStore((state) => state.workspaceDir);
  const { t } = useTranslation("chat");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("header.openFolder")}
            disabled={!workspaceDir}
            onClick={() => {
              if (workspaceDir)
                bridge.files
                  .openWorkspace(workspaceDir)
                  .catch((error: Error) => toast.error(error.message));
            }}
          />
        }
      >
        <FolderOpenIcon />
      </TooltipTrigger>
      <TooltipContent>{t("header.openFolder")}</TooltipContent>
    </Tooltip>
  );
}

/** Right end of the chat's top bar: context window and the workspace folder. */
export function ChatHeaderActions({ bridge }: { bridge: DesktopBridge }) {
  return (
    <div className="ml-auto flex items-center gap-0.5">
      <ContextButton bridge={bridge} />
      <OpenFolderButton bridge={bridge} />
    </div>
  );
}
