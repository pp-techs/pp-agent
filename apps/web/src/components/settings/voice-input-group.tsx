import * as React from "react";
import {
  DEFAULT_VOICE_MODEL,
  VOICE_LIMITS,
  type DesktopBridge,
  type VoiceSettings,
} from "@workspace/shared";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Field, FieldDescription, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Spinner } from "@workspace/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { OptionGroup } from "@/components/settings/option-group";
import { useSaveVoice, voiceQuery } from "@/lib/extension-queries";

/** Select value for "no provider chosen"; real provider ids never equal it. */
const NONE = "__none__";
const APP = "app";
const AUTO = "auto";
/** Languages offered by name; any other saved code is still shown and kept. */
const LANGUAGE_CODES = ["en", "vi", "zh", "ja", "ko", "fr", "de", "es", "pt", "ru", "th", "id"];

function VoiceForm({ bridge }: { bridge: DesktopBridge }) {
  const { t, i18n } = useTranslation(["settings", "common"]);
  const voice = useQuery(voiceQuery(bridge));
  const save = useSaveVoice(bridge);
  const [providerId, setProviderId] = React.useState<string | null>(null);
  const [model, setModel] = React.useState(DEFAULT_VOICE_MODEL);
  const [language, setLanguage] = React.useState(APP);
  const [loadedFrom, setLoadedFrom] = React.useState<VoiceSettings | null>(null);

  // Adopt what the agent reports (first load, or a change made elsewhere) while nothing is edited.
  const config = voice.data?.config;
  if (config && loadedFrom !== config) {
    setLoadedFrom(config);
    setProviderId(config.providerId);
    setModel(config.model);
    setLanguage(config.language);
  }

  if (voice.isPending) return <Spinner />;
  if (voice.isError) {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>{t("general.voice.loadError")}</AlertTitle>
        <AlertDescription>{voice.error.message}</AlertDescription>
      </Alert>
    );
  }

  const providers = voice.data.providers;
  const providerMissing = providerId !== null && !providers.some((item) => item.id === providerId);
  const providerItems = [
    { value: NONE, label: t("general.voice.provider.none") },
    ...(providerMissing && providerId ? [{ value: providerId, label: providerId }] : []),
    ...providers.map((item) => ({ value: item.id, label: item.name })),
  ];
  const names = new Intl.DisplayNames(i18n.language, { type: "language" });
  const codes =
    LANGUAGE_CODES.includes(language) || language === APP || language === AUTO
      ? LANGUAGE_CODES
      : [...LANGUAGE_CODES, language];
  const languageItems = [
    { value: APP, label: t("general.voice.language.app") },
    { value: AUTO, label: t("general.voice.language.auto") },
    ...codes.map((code) => ({ value: code, label: names.of(code) ?? code })),
  ];
  const trimmedModel = model.trim();
  const modelInvalid = !trimmedModel || trimmedModel.length > VOICE_LIMITS.maxModelLength;
  const dirty =
    voice.data.config.providerId !== providerId ||
    voice.data.config.model !== trimmedModel ||
    voice.data.config.language !== language;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (modelInvalid) return;
    save.mutate(
      { providerId, model: trimmedModel, language },
      { onSuccess: () => toast.success(t("general.voice.saved")) },
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="voice-provider">{t("general.voice.provider.label")}</FieldLabel>
        <Select
          items={providerItems}
          value={providerId ?? NONE}
          onValueChange={(next) => next !== null && setProviderId(next === NONE ? null : next)}
        >
          <SelectTrigger id="voice-provider" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {providerItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>
          {providers.length === 0
            ? t("general.voice.provider.empty")
            : t("general.voice.provider.help")}
        </FieldDescription>
      </Field>
      <Field data-invalid={modelInvalid}>
        <FieldLabel htmlFor="voice-model">{t("general.voice.model.label")}</FieldLabel>
        <Input
          id="voice-model"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          maxLength={VOICE_LIMITS.maxModelLength}
          autoComplete="off"
          aria-invalid={modelInvalid}
        />
        <FieldDescription>{t("general.voice.model.help")}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="voice-language">{t("general.voice.language.label")}</FieldLabel>
        <Select
          items={languageItems}
          value={language}
          onValueChange={(next) => next !== null && setLanguage(next)}
        >
          <SelectTrigger id="voice-language" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {languageItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>{t("general.voice.language.help")}</FieldDescription>
      </Field>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {voice.data.ready ? t("general.voice.ready") : t("general.voice.notReady")}
        </p>
        <Button type="submit" disabled={!dirty || modelInvalid || save.isPending}>
          {save.isPending && <Spinner />}
          {t("general.voice.save")}
        </Button>
      </div>
    </form>
  );
}

/** "Voice input" group of Settings › General: which service turns recordings into text. */
export function VoiceInputGroup({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("settings");
  return (
    <OptionGroup legend={t("general.voice.legend")} description={t("general.voice.description")}>
      <VoiceForm bridge={bridge} />
    </OptionGroup>
  );
}
