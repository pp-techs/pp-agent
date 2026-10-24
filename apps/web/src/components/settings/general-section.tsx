import {
  LANGUAGE_SETTINGS,
  LANGUAGES,
  type DesktopBridge,
  type LanguageSetting,
} from "@workspace/shared";
import { LANGUAGE_NAMES } from "@workspace/shared/i18n";
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
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useTheme } from "@/components/theme-provider";
import { SectionHeading } from "@/components/settings/section-heading";
import { DesktopGroup } from "@/components/settings/desktop-group";
import { VoiceInputGroup } from "@/components/settings/voice-input-group";
import { groupByProvider, modelKey, modelLabeler } from "@/lib/models";
import { modelsQuery, settingsQuery, useUpdateSettings } from "@/lib/queries";
import { describeUpdate, updateAction } from "@/components/update-actions";
import { useChatStore } from "@/stores/chat-store";
import { useUpdateStore } from "@/stores/update-store";

const THEMES = [
  { value: "system", icon: MonitorIcon },
  { value: "light", icon: SunIcon },
  { value: "dark", icon: MoonIcon },
] as const;
type Theme = (typeof THEMES)[number]["value"];

const isTheme = (value: string | undefined): value is Theme =>
  THEMES.some((theme) => theme.value === value);

const isLanguageSetting = (value: string | null): value is LanguageSetting =>
  LANGUAGE_SETTINGS.some((setting) => setting === value);

/** Select value for "no default": new chats use the first available model. */
const AUTOMATIC = "automatic";

function LanguageField({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("settings");
  const settings = useQuery(settingsQuery(bridge));
  const update = useUpdateSettings(bridge);

  if (settings.isPending) return <Spinner />;

  const current = settings.data?.language ?? "system";
  const items = [
    { value: "system", label: t("general.language.options.system") },
    ...LANGUAGES.map((language) => ({ value: language, label: LANGUAGE_NAMES[language] })),
  ];

  function onChange(value: string | null) {
    if (!isLanguageSetting(value) || value === current) return;
    update.mutate({ language: value }, { onError: (error) => toast.error(error.message) });
  }

  return (
    <Field>
      <FieldLabel>{t("general.language.title")}</FieldLabel>
      <Select items={items} value={current} onValueChange={onChange}>
        <SelectTrigger className="w-full" disabled={update.isPending}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>{t("general.language.description")}</FieldDescription>
    </Field>
  );
}

function DefaultModelField({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("settings");
  const settings = useQuery(settingsQuery(bridge));
  const models = useQuery(modelsQuery(bridge));
  const update = useUpdateSettings(bridge);

  if (settings.isPending || models.isPending) return <Spinner />;

  const available = models.data ?? [];
  const label = modelLabeler(available);
  const current = settings.data?.defaultModel ?? null;
  const currentKey = current ? modelKey(current) : AUTOMATIC;
  const missing = current !== null && !available.some((model) => modelKey(model) === currentKey);
  const items = [
    { value: AUTOMATIC, label: t("general.defaultModel.firstAvailable") },
    ...(missing && current
      ? [
          {
            value: currentKey,
            label: t("general.defaultModel.notAvailable", { modelId: current.modelId }),
          },
        ]
      : []),
    ...available.map((model) => ({
      value: modelKey(model),
      label: `${label(model)} · ${model.providerName}`,
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
      <FieldLabel>{t("general.defaultModel.label")}</FieldLabel>
      <Select items={items} value={currentKey} onValueChange={onChange}>
        <SelectTrigger className="w-full" disabled={update.isPending}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTOMATIC}>{t("general.defaultModel.firstAvailable")}</SelectItem>
          {missing && current && (
            <SelectItem value={currentKey} disabled>
              {t("general.defaultModel.notAvailable", { modelId: current.modelId })}
            </SelectItem>
          )}
          {groupByProvider(available).map(([provider, group]) => (
            <SelectGroup key={provider}>
              <SelectLabel>{group.name}</SelectLabel>
              {group.models.map((model) => (
                <SelectItem key={modelKey(model)} value={modelKey(model)} disabled={model.needsKey}>
                  {model.needsKey
                    ? t("general.defaultModel.needsKey", { name: label(model) })
                    : label(model)}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>
        {available.length === 0
          ? t("general.defaultModel.emptyHint")
          : t("general.defaultModel.hint")}
      </FieldDescription>
    </Field>
  );
}

function UpdatesField({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("settings");
  const update = useUpdateStore((state) => state.update);
  if (!update) return null;
  const action = updateAction(bridge, update);
  const busy = update.status === "checking" || update.status === "downloading";

  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldTitle>{t("general.updates.title")}</FieldTitle>
        <FieldDescription>{describeUpdate(update)}</FieldDescription>
      </FieldContent>
      {update.status !== "disabled" && (
        <Button variant="outline" disabled={busy || !action} onClick={() => action?.run()}>
          {busy && <Spinner data-icon="inline-start" />}
          {action?.label ?? t("general.updates.check")}
        </Button>
      )}
    </Field>
  );
}

export function GeneralSection({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("settings");
  const workspaceDir = useChatStore((state) => state.workspaceDir);
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading title={t("general.title")} description={t("general.description")} />
      <FieldGroup>
        <LanguageField bridge={bridge} />
        <Field orientation="horizontal">
          <FieldContent className="min-w-0">
            <FieldTitle>{t("general.workspaceFolder.title")}</FieldTitle>
            <FieldDescription className="truncate font-mono text-xs" title={workspaceDir ?? ""}>
              {workspaceDir ?? t("general.workspaceFolder.unavailable")}
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
            {t("general.workspaceFolder.open")}
          </Button>
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle>{t("general.theme.title")}</FieldTitle>
            <FieldDescription>{t("general.theme.description")}</FieldDescription>
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
            {THEMES.map(({ value, icon: Icon }) => {
              const label = t(`general.theme.options.${value}`);
              return (
                <ToggleGroupItem key={value} value={value} aria-label={label}>
                  <Icon />
                  {label}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </Field>
        <DefaultModelField bridge={bridge} />
        <DesktopGroup bridge={bridge} />
        <VoiceInputGroup bridge={bridge} />
        <UpdatesField bridge={bridge} />
      </FieldGroup>
    </div>
  );
}
