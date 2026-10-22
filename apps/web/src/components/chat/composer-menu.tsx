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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <InputGroupButton
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Add files, skills, and commands"
            disabled={disabled}
          />
        }
      >
        <PlusIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuItem onClick={onAttach}>
          <PaperclipIcon />
          Attach files…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SparklesIcon />
            Skills
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 w-72 overflow-y-auto">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Use a skill in this message</DropdownMenuLabel>
              {skills.length === 0 && (
                <DropdownMenuItem disabled>No skills for this agent</DropdownMenuItem>
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
              Manage skills…
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <TerminalIcon />
            Commands
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
