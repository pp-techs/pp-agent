import { type DesktopBridge, type ThinkingLevel } from "@workspace/shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { InputGroupButton } from "@workspace/ui/components/input-group";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import { toast } from "sonner";

import { useAgentCommands } from "@/lib/queries";
import { useChatStore } from "@/stores/chat-store";

const LABELS: Record<ThinkingLevel, { label: string; hint: string }> = {
  off: { label: "Off", hint: "Answers right away" },
  minimal: { label: "Minimal", hint: "A quick look before answering" },
  low: { label: "Low", hint: "Some thought for simple tasks" },
  medium: { label: "Medium", hint: "Balanced for most work" },
  high: { label: "High", hint: "Careful reasoning, slower" },
  xhigh: { label: "Extra high", hint: "Very thorough, slower and costlier" },
  max: { label: "Max", hint: "Deepest reasoning, slowest" },
};

/**
 * Thinking (reasoning effort) of the open conversation. Hidden when its model can't think; new
 * conversations start with the level picked last.
 */
export function ThinkingPicker({ bridge, disabled }: { bridge: DesktopBridge; disabled: boolean }) {
  const thinking = useChatStore((state) => state.thinking);
  const running = useChatStore((state) => state.status === "running");
  const { setThinkingLevel } = useAgentCommands(bridge);
  if (thinking.available.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <InputGroupButton
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || running}
            title={running ? "Wait for the answer to finish" : "How much the model thinks first"}
          />
        }
      >
        <BrainIcon data-icon="inline-start" className="text-muted-foreground" />
        <span>{thinking.level === "off" ? "Thinking off" : LABELS[thinking.level].label}</span>
        <ChevronDownIcon data-icon="inline-end" className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Thinking</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={thinking.level}
            onValueChange={(value) =>
              setThinkingLevel.mutate(value as ThinkingLevel, {
                onError: (error) => toast.error(error.message),
              })
            }
          >
            {thinking.available.map((level) => (
              <DropdownMenuRadioItem key={level} value={level}>
                <span className="flex flex-col">
                  <span>{LABELS[level].label}</span>
                  <span className="text-xs text-muted-foreground">{LABELS[level].hint}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
