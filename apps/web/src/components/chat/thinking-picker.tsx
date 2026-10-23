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
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useAgentCommands } from "@/lib/queries";
import { useChatStore } from "@/stores/chat-store";

/**
 * Thinking (reasoning effort) of the open conversation. Hidden when its model can't think; new
 * conversations start with the level picked last.
 */
export function ThinkingPicker({ bridge, disabled }: { bridge: DesktopBridge; disabled: boolean }) {
  const thinking = useChatStore((state) => state.thinking);
  const running = useChatStore((state) => state.status === "running");
  const { setThinkingLevel } = useAgentCommands(bridge);
  const { t } = useTranslation("chat");
  if (thinking.available.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <InputGroupButton
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 rounded-full px-3 font-normal text-muted-foreground outline-none focus-visible:ring-0"
            disabled={disabled || running}
            title={running ? t("waitForAnswer") : t("thinking.description")}
          />
        }
      >
        <BrainIcon data-icon="inline-start" className="text-muted-foreground" />
        <span>
          {thinking.level === "off"
            ? t("thinking.off")
            : t(`thinking.levels.${thinking.level}.label`)}
        </span>
        <ChevronDownIcon data-icon="inline-end" className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("thinking.title")}</DropdownMenuLabel>
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
                  <span>{t(`thinking.levels.${level}.label`)}</span>
                  <span className="text-xs text-muted-foreground">
                    {t(`thinking.levels.${level}.hint`)}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
