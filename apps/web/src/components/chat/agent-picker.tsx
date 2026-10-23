import * as React from "react";
import { DEFAULT_AGENT_ID, type DesktopBridge } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command";

import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { Spinner } from "@workspace/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, SettingsIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { SettingsModal } from "@/components/modals/settings-modal";
import { agentsQuery, useAgentCommands } from "@/lib/queries";
import { useChatStore } from "@/stores/chat-store";

/** Agent of the open conversation (in the top bar); new conversations start with the one picked last. */
export function AgentPicker({ bridge, disabled }: { bridge: DesktopBridge; disabled: boolean }) {
  const current = useChatStore((state) => state.agent);
  const running = useChatStore((state) => state.status === "running");
  const agents = useQuery(agentsQuery(bridge));
  const { setAgent } = useAgentCommands(bridge);
  const [open, setOpen] = React.useState(false);
  const { t } = useTranslation("chat");
  const currentId = current?.id ?? DEFAULT_AGENT_ID;

  const openSettings = () => {
    setOpen(false);
    void SettingsModal.show({ bridge, section: "agents" });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            className="max-w-72 min-w-0 font-heading font-medium"
            disabled={disabled || running}
            title={running ? t("waitForAnswer") : t("agentPicker.change")}
          />
        }
      >
        <span aria-hidden>{current?.icon ?? "🤖"}</span>
        <span className="truncate">{current?.name ?? "PP Agent"}</span>
        {setAgent.isPending ? (
          <Spinner data-icon="inline-end" />
        ) : (
          <ChevronDownIcon data-icon="inline-end" className="text-muted-foreground" />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-0 p-0">
        <Command>
          <CommandInput placeholder={t("agentPicker.search")} />
          <CommandList>
            {agents.isPending ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : (
              <CommandEmpty>
                {agents.isError ? agents.error.message : t("agentPicker.noMatch")}
              </CommandEmpty>
            )}
            {agents.data?.map((agent) => (
              <CommandItem
                key={agent.id}
                value={agent.id}
                keywords={[agent.name, agent.description]}
                data-checked={agent.id === currentId}
                onSelect={() => {
                  setOpen(false);
                  if (agent.id === currentId) return;
                  setAgent.mutate(agent.id, { onError: (error) => toast.error(error.message) });
                }}
              >
                <span aria-hidden className="shrink-0 self-start text-base leading-5">
                  {agent.icon}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{agent.name}</span>
                  {agent.description && (
                    <span className="truncate text-xs text-muted-foreground">
                      {agent.description}
                    </span>
                  )}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
        <div className="border-t p-1">
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={openSettings}>
            <SettingsIcon data-icon="inline-start" />
            {t("agentPicker.manage")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
