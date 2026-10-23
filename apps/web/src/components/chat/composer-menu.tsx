import type { DesktopBridge } from "@workspace/shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { InputGroupButton } from "@workspace/ui/components/input-group";
import { PaperclipIcon, PlusIcon, SettingsIcon, SparklesIcon, TerminalIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SettingsModal } from "@/components/modals/settings-modal";
import { type SlashItem, slashText } from "@/lib/slash-commands";

/** The composer's + button: attach files, insert a skill, or run a command. */
export function ComposerMenu({
  bridge,
  disabled,
  commands,
  skills,
  onAttach,
  onPick,
}: {
  bridge: DesktopBridge;
  disabled: boolean;
  commands: SlashItem[];
  skills: SlashItem[];
  onAttach: () => void;
  onPick: (item: SlashItem) => void;
}) {
  const { t } = useTranslation("chat");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <InputGroupButton
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-9 rounded-full text-foreground outline-none focus-visible:ring-0 [&_svg:not([class*='size-'])]:size-5"
            aria-label={t("composerMenu.add")}
            disabled={disabled}
          />
        }
      >
        <PlusIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuItem onClick={onAttach}>
          <PaperclipIcon />
          {t("composerMenu.attach")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SparklesIcon />
            {t("composerMenu.skills")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 w-72 overflow-y-auto">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("composerMenu.skillsHeading")}</DropdownMenuLabel>
              {skills.length === 0 && (
                <DropdownMenuItem disabled>{t("composerMenu.noSkills")}</DropdownMenuItem>
              )}
              {skills.map((skill) => (
                <DropdownMenuItem key={skill.name} onClick={() => onPick(skill)}>
                  <span className="flex min-w-0 flex-col">
                    <span className="font-mono text-xs">{slashText(skill).trim()}</span>
                    <span className="line-clamp-1 text-xs text-muted-foreground">
                      {skill.description}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => void SettingsModal.show({ bridge, section: "skills" })}
            >
              <SettingsIcon />
              {t("composerMenu.manageSkills")}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <TerminalIcon />
            {t("composerMenu.commands")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-72">
            {commands.map((command) => (
              <DropdownMenuItem key={command.name} onClick={() => onPick(command)}>
                <span className="flex min-w-0 flex-col">
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-xs">{slashText(command)}</span>
                    <span className="text-xs">{command.label}</span>
                  </span>
                  <span className="line-clamp-1 text-xs text-muted-foreground">
                    {command.description}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
