import type { DesktopBridge } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@workspace/ui/components/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Spinner } from "@workspace/ui/components/spinner";
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group";
import { useQuery } from "@tanstack/react-query";
import { FolderOpenIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { toast } from "sonner";

import { useTheme } from "@/components/theme-provider";
import { SectionHeading } from "@/components/settings/section-heading";
import { groupByProvider, modelKey } from "@/lib/models";
import { modelsQuery, settingsQuery, useUpdateSettings } from "@/lib/queries";
import { describeUpdate, updateAction } from "@/components/update-actions";
import { useChatStore } from "@/stores/chat-store";
import { useUpdateStore } from "@/stores/update-store";

const THEMES = [
  { value: "system", label: "System", icon: MonitorIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
] as const;
type Theme = (typeof THEMES)[number]["value"];

const isTheme = (value: string | undefined): value is Theme =>
  THEMES.some((theme) => theme.value === value);

/** Select value for "no default": new chats use the first available model. */
const AUTOMATIC = "automatic";

function DefaultModelField({ bridge }: { bridge: DesktopBridge }) {
  const settings = useQuery(settingsQuery(bridge));
  const models = useQuery(modelsQuery(bridge));
  const update = useUpdateSettings(bridge);

  if (settings.isPending || models.isPending) return <Spinner />;

  const available = models.data ?? [];
  const current = settings.data?.defaultModel ?? null;
  const currentKey = current ? modelKey(current) : AUTOMATIC;
  const missing = current !== null && !available.some((model) => modelKey(model) === currentKey);
  const items = [
    { value: AUTOMATIC, label: "First available model" },
    ...(missing && current
      ? [{ value: currentKey, label: `${current.modelId} (not available)` }]
      : []),
    ...available.map((model) => ({
      value: modelKey(model),
      label: `${model.name} · ${model.providerName}`,
    })),
  ];

  function onChange(value: string | null) {
    if (value === null || value === currentKey) return;
    const model = available.find((item) => modelKey(item) === value);
    update.mutate(
      { defaultModel: model ? { provider: model.provider, modelId: model.modelId } : null },
      { onError: (error) => toast.error(error.message) },
    );
  }

  return (
    <Field>
      <FieldLabel>Default model</FieldLabel>
      <Select items={items} value={currentKey} onValueChange={onChange}>
        <SelectTrigger className="w-full" disabled={update.isPending}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTOMATIC}>First available model</SelectItem>
          {missing && current && (
            <SelectItem value={currentKey} disabled>
              {current.modelId} (not available)
            </SelectItem>
          )}
          {groupByProvider(available).map(([provider, group]) => (
            <SelectGroup key={provider}>
              <SelectLabel>{group.name}</SelectLabel>
              {group.models.map((model) => (
                <SelectItem key={modelKey(model)} value={modelKey(model)}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>
        {available.length === 0
          ? "Connect a provider in Models to choose a default."
          : "Used for new chats. You can switch models in any chat from below the message box."}
      </FieldDescription>
    </Field>
  );
}

function UpdatesField({ bridge }: { bridge: DesktopBridge }) {
  const update = useUpdateStore((state) => state.update);
  if (!update) return null;
  const action = updateAction(bridge, update);
  const busy = update.status === "checking" || update.status === "downloading";

  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldTitle>Updates</FieldTitle>
        <FieldDescription>{describeUpdate(update)}</FieldDescription>
      </FieldContent>
      {update.status !== "disabled" && (
        <Button variant="outline" disabled={busy || !action} onClick={() => action?.run()}>
          {busy && <Spinner data-icon="inline-start" />}
          {action?.label ?? "Check for updates"}
        </Button>
      )}
    </Field>
  );
}

export function GeneralSection({ bridge }: { bridge: DesktopBridge }) {
  const workspaceDir = useChatStore((state) => state.workspaceDir);
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        title="General"
        description="Your workspace, appearance, default model, and updates."
      />
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldContent className="min-w-0">
            <FieldTitle>Workspace folder (current agent)</FieldTitle>
            <FieldDescription className="truncate font-mono text-xs" title={workspaceDir ?? ""}>
              {workspaceDir ?? "Not available yet"}
            </FieldDescription>
          </FieldContent>
          <Button
            variant="outline"
            disabled={!workspaceDir}
            onClick={() => {
              if (!workspaceDir) return;
              bridge.files
                .openWorkspace(workspaceDir)
                .catch((error: Error) => toast.error(error.message));
            }}
          >
            <FolderOpenIcon data-icon="inline-start" />
            Open folder
          </Button>
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle>Theme</FieldTitle>
            <FieldDescription>Follow your system, or always use light or dark.</FieldDescription>
          </FieldContent>
          <ToggleGroup
            variant="outline"
            spacing={0}
            value={[theme]}
            onValueChange={(value) => {
              const next = value[0];
              if (isTheme(next)) setTheme(next);
            }}
          >
            {THEMES.map(({ value, label, icon: Icon }) => (
              <ToggleGroupItem key={value} value={value} aria-label={label}>
                <Icon />
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <DefaultModelField bridge={bridge} />
        <UpdatesField bridge={bridge} />
      </FieldGroup>
    </div>
  );
}
