import * as React from "react";
import type { DesktopBridge, SessionUsage } from "@workspace/shared";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { Spinner } from "@workspace/ui/components/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { DownloadIcon, FileTextIcon, FolderOpenIcon, GlobeIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useExportSession } from "@/hooks/use-export-session";
import { useAgentCommands, usageQuery } from "@/lib/queries";
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

/** Estimated cost in US dollars, with enough digits for the small amounts a short chat costs. */
function formatCost(value: number, language: string) {
  return new Intl.NumberFormat(language, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 0.01 ? 4 : value < 1 ? 3 : 2,
  }).format(value);
}

/** Tokens and estimated cost of the open conversation, summed over all of its replies. */
function UsageSummary({ usage, language }: { usage: SessionUsage; language: string }) {
  const { t } = useTranslation("chat");
  const number = new Intl.NumberFormat(language);
  const total = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  if (total === 0) {
    return <p className="text-xs text-muted-foreground">{t("header.usage.empty")}</p>;
  }
  const cost =
    usage.cost === null
      ? t("header.usage.costUnknown")
      : usage.costPartial
        ? t("header.usage.costPartial", { cost: formatCost(usage.cost, language) })
        : formatCost(usage.cost, language);
  const rows: Array<[string, string]> = [
    [t("header.usage.input"), number.format(usage.input)],
    [t("header.usage.output"), number.format(usage.output)],
    ...(usage.cacheRead > 0
      ? [[t("header.usage.cacheRead"), number.format(usage.cacheRead)] as [string, string]]
      : []),
    ...(usage.cacheWrite > 0
      ? [[t("header.usage.cacheWrite"), number.format(usage.cacheWrite)] as [string, string]]
      : []),
    [t("header.usage.cost"), cost],
  ];
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-right tabular-nums">{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
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
  const sessionPath = useChatStore((state) => state.sessionPath);
  const { compact } = useAgentCommands(bridge);
  const { t, i18n } = useTranslation("chat");
  const { language } = i18n;
  // The context figure changes after every reply, which is when the totals change as well.
  const usage = useQuery(usageQuery(bridge, sessionPath, `${status}:${context?.tokens ?? ""}`));
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
        <div className="flex flex-col gap-1 border-t pt-3">
          <p className="text-sm font-medium">{t("header.usage.title")}</p>
          {usage.data && <UsageSummary usage={usage.data} language={language} />}
        </div>
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

/** Exports the open conversation, once it has been saved (it has a reply). */
function ExportButton({ bridge }: { bridge: DesktopBridge }) {
  const sessionPath = useChatStore((state) => state.sessionPath);
  const status = useChatStore((state) => state.status);
  const hasMessages = useChatStore((state) => state.messages.length > 0);
  const exportSession = useExportSession(bridge);
  const { t } = useTranslation("chat");
  // While an answer is written the file lacks it, so the export would stop short.
  const disabled = !sessionPath || !hasMessages || status !== "idle" || exportSession.isPending;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("header.export.label")}
                  disabled={disabled}
                />
              }
            />
          }
        >
          <DownloadIcon />
        </TooltipTrigger>
        <TooltipContent>{t("header.export.label")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem
          onClick={() => sessionPath && exportSession.mutate({ path: sessionPath, format: "md" })}
        >
          <FileTextIcon />
          {t("header.export.markdown")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => sessionPath && exportSession.mutate({ path: sessionPath, format: "html" })}
        >
          <GlobeIcon />
          {t("header.export.html")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Right end of the chat's top bar: context window, export, and the workspace folder. */
export function ChatHeaderActions({ bridge }: { bridge: DesktopBridge }) {
  return (
    <div className="ml-auto flex items-center gap-0.5">
      <ContextButton bridge={bridge} />
      <ExportButton bridge={bridge} />
      <OpenFolderButton bridge={bridge} />
    </div>
  );
}
