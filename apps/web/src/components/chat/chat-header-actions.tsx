import type { DesktopBridge } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { Spinner } from "@workspace/ui/components/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { FolderOpenIcon } from "lucide-react";
import { toast } from "sonner";

import { useAgentCommands } from "@/lib/queries";
import { useChatStore } from "@/stores/chat-store";

const RING_SIZE = 18;
const RING_STROKE = 2.5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** Above this share of the window, Pi is about to compact the conversation on its own. */
const WARN_AT = 0.8;

/** 1.2k, 45k, 1.0M: token counts the way model cards print them. */
function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
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
  if (!context) return null;

  const share = context.tokens === null ? null : context.tokens / context.window;
  const percent = share === null ? null : Math.round(share * 100);
  const label = percent === null ? "Context window" : `Context window, ${percent}% used`;
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
          <p className="text-sm font-medium">Context window</p>
          <p className="text-sm text-muted-foreground">
            {context.tokens === null
              ? `Unknown until the next reply · ${formatTokens(context.window)} available`
              : `${formatTokens(context.tokens)} of ${formatTokens(context.window)} tokens used (${percent}%)`}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          When the window fills up, older messages are summarized automatically. You can do it now
          to free up room.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={!canCompact}
          onClick={() =>
            compact.mutate(undefined, { onError: (error) => toast.error(error.message) })
          }
        >
          {compact.isPending && <Spinner />}
          Compact conversation
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** Opens the folder the open conversation works in (its workspace's folder). */
function OpenFolderButton({ bridge }: { bridge: DesktopBridge }) {
  const workspaceDir = useChatStore((state) => state.workspaceDir);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open workspace folder"
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
      <TooltipContent>Open workspace folder</TooltipContent>
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
