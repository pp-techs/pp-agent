import * as React from "react";
import type { DesktopBridge } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command";
import { InputGroupButton } from "@workspace/ui/components/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { Spinner } from "@workspace/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { BrainIcon, ChevronDownIcon, ImageIcon, SettingsIcon, SparklesIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { SettingsModal } from "@/components/modals/settings-modal";
import { groupByProvider, modelKey, modelLabeler } from "@/lib/models";
import { modelsQuery, useAgentCommands } from "@/lib/queries";
import { useChatStore } from "@/stores/chat-store";

/** Model of the open conversation (in the composer); changing it only affects this chat. */
export function ModelPicker({ bridge }: { bridge: DesktopBridge }) {
  const current = useChatStore((state) => state.model);
  const status = useChatStore((state) => state.status);
  const models = useQuery(modelsQuery(bridge));
  const label = modelLabeler(models.data ?? []);
  const { setModel } = useAgentCommands(bridge);
  const [open, setOpen] = React.useState(false);
  const { t } = useTranslation("chat");

  const openSettings = () => {
    setOpen(false);
    void SettingsModal.show({ bridge, section: "models" });
  };

  if (status === "starting") return null;
  if (status === "unconfigured" || !current) {
    return (
      <InputGroupButton type="button" variant="outline" size="sm" onClick={openSettings}>
        <SparklesIcon data-icon="inline-start" />
        {t("modelPicker.choose")}
      </InputGroupButton>
    );
  }

  const currentKey = modelKey(current);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <InputGroupButton
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 max-w-56 min-w-0 rounded-full px-3 font-normal text-muted-foreground outline-none focus-visible:ring-0"
            disabled={status === "running"}
            title={
              status === "running"
                ? t("waitForAnswer")
                : t("modelPicker.change", { modelId: current.modelId })
            }
          />
        }
      >
        <span className="truncate">{label(current)}</span>
        {setModel.isPending ? (
          <Spinner data-icon="inline-end" />
        ) : (
          <ChevronDownIcon data-icon="inline-end" className="text-muted-foreground" />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 gap-0 p-0">
        <Command>
          <CommandInput placeholder={t("modelPicker.search")} />
          <CommandList>
            {models.isPending ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : (
              <CommandEmpty>
                {models.data?.length ? t("modelPicker.noMatch") : t("modelPicker.none")}
              </CommandEmpty>
            )}
            {groupByProvider(models.data ?? []).map(([provider, group]) => (
              <CommandGroup key={provider} heading={group.name}>
                {group.models.map((model) => {
                  const key = modelKey(model);
                  return (
                    <CommandItem
                      key={key}
                      value={key}
                      keywords={[label(model), model.name, model.modelId, model.providerName]}
                      data-checked={key === currentKey}
                      onSelect={() => {
                        setOpen(false);
                        if (key === currentKey) return;
                        setModel.mutate(
                          { provider: model.provider, modelId: model.modelId },
                          { onError: (error) => toast.error(error.message) },
                        );
                      }}
                    >
                      <span className="flex-1 truncate" title={model.modelId}>
                        {label(model)}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                        {model.images && (
                          <ImageIcon className="size-3.5" aria-label={t("modelPicker.images")} />
                        )}
                        {model.reasoning && (
                          <BrainIcon className="size-3.5" aria-label={t("modelPicker.reasoning")} />
                        )}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
        <div className="border-t p-1">
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={openSettings}>
            <SettingsIcon data-icon="inline-start" />
            {t("modelPicker.manage")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
