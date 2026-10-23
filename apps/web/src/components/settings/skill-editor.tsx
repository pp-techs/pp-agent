import * as React from "react";
import type { DesktopBridge, SkillDetail } from "@workspace/shared";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Kbd } from "@workspace/ui/components/kbd";
import { Spinner } from "@workspace/ui/components/spinner";
import { Switch } from "@workspace/ui/components/switch";
import { Textarea } from "@workspace/ui/components/textarea";
import { useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { Trans, useTranslation } from "react-i18next";
import { ArrowLeftIcon, FileIcon, FolderOpenIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { useSettingsSubPage } from "@/components/settings/settings-subpage";
import { skillQuery, useSaveSkill } from "@/lib/extension-queries";

const NAME_MAX = 64;
const DESCRIPTION_MAX = 1024;

function nameError(name: string, t: TFunction<"extensions">) {
  if (!name) return t("skillEditor.validation.nameRequired");
  if (name.length > NAME_MAX) return t("skillEditor.validation.tooLong", { max: NAME_MAX });
  if (!/^[a-z0-9-]+$/.test(name)) return t("skillEditor.validation.nameFormat");
  return null;
}

function descriptionError(description: string, t: TFunction<"extensions">) {
  if (!description) return t("skillEditor.validation.descriptionRequired");
  if (description.length > DESCRIPTION_MAX) {
    return t("skillEditor.validation.tooLong", { max: DESCRIPTION_MAX });
  }
  return null;
}

function SkillForm({
  bridge,
  detail,
  onDone,
}: {
  bridge: DesktopBridge;
  detail?: SkillDetail;
  onDone: () => void;
}) {
  const { t } = useTranslation(["extensions", "common"]);
  const [name, setName] = React.useState(detail?.name ?? "");
  const [description, setDescription] = React.useState(detail?.description ?? "");
  const [modelInvocable, setModelInvocable] = React.useState(detail?.modelInvocable ?? true);
  const [body, setBody] = React.useState(detail?.body ?? "");
  const [touched, setTouched] = React.useState(false);
  const save = useSaveSkill(bridge);

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const errors = {
    name: nameError(trimmedName, t),
    description: descriptionError(trimmedDescription, t),
  };
  const valid = !errors.name && !errors.description;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (!valid) return;
    save.mutate(
      {
        originalName: detail?.name,
        name: trimmedName,
        description: trimmedDescription,
        modelInvocable,
        body,
      },
      {
        onSuccess: (skill) => {
          toast.success(t("skillEditor.saved", { name: skill.name }));
          onDone();
        },
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <FieldGroup>
        <Field data-invalid={touched && Boolean(errors.name)}>
          <FieldLabel htmlFor="skill-name">{t("skillEditor.fields.name.label")}</FieldLabel>
          <Input
            id="skill-name"
            value={name}
            // Lowercase and hyphenate as people type ("Sales Report" → "sales-report").
            onChange={(event) => setName(event.target.value.toLowerCase().replace(/\s+/g, "-"))}
            placeholder={t("skillEditor.fields.name.placeholder")}
            maxLength={NAME_MAX}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={touched && Boolean(errors.name)}
            className="font-mono"
          />
          {touched && errors.name ? (
            <FieldError>{errors.name}</FieldError>
          ) : (
            <FieldDescription>
              <Trans
                t={t}
                i18nKey="skillEditor.fields.name.hint"
                values={{ name: trimmedName || t("skillEditor.nameFallback") }}
                components={{ kbd: <Kbd className="font-mono" /> }}
              />
            </FieldDescription>
          )}
        </Field>
        <Field data-invalid={touched && Boolean(errors.description)}>
          <FieldLabel htmlFor="skill-description">
            {t("skillEditor.fields.description.label")}
          </FieldLabel>
          <Textarea
            id="skill-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("skillEditor.fields.description.placeholder")}
            maxLength={DESCRIPTION_MAX}
            aria-invalid={touched && Boolean(errors.description)}
            className="min-h-20"
          />
          {touched && errors.description ? (
            <FieldError>{errors.description}</FieldError>
          ) : (
            <FieldDescription>
              {t("skillEditor.fields.description.hint", {
                current: description.length,
                max: DESCRIPTION_MAX,
              })}
            </FieldDescription>
          )}
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="skill-auto">{t("skillEditor.fields.auto.label")}</FieldLabel>
            <FieldDescription>
              {t("skillEditor.fields.auto.description", {
                name: trimmedName || t("skillEditor.nameFallback"),
              })}
            </FieldDescription>
          </FieldContent>
          <Switch id="skill-auto" checked={modelInvocable} onCheckedChange={setModelInvocable} />
        </Field>
        <Field>
          <FieldLabel htmlFor="skill-body">{t("skillEditor.fields.body.label")}</FieldLabel>
          <Textarea
            id="skill-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={t("skillEditor.fields.body.placeholder")}
            spellCheck={false}
            className="min-h-80 resize-y font-mono text-xs md:text-xs"
          />
          <FieldDescription>{t("skillEditor.fields.body.hint")}</FieldDescription>
        </Field>
        {detail && detail.files.length > 0 && (
          <Field>
            <FieldLabel>{t("skillEditor.fields.files.label")}</FieldLabel>
            <ul className="flex flex-col gap-1 rounded-xl bg-muted/50 p-3">
              {detail.files.map((file) => (
                <li key={file} className="flex items-center gap-2 font-mono text-xs">
                  <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{file}</span>
                </li>
              ))}
            </ul>
            <FieldDescription className="flex flex-wrap items-center gap-2">
              {t("skillEditor.fields.files.hint")}
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() =>
                  bridge.files
                    .reveal(detail.path)
                    .catch((error: Error) => toast.error(error.message))
                }
              >
                <FolderOpenIcon />
                {t("showInFolder")}
              </Button>
            </FieldDescription>
          </Field>
        )}
      </FieldGroup>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common:actions.cancel")}
        </Button>
        <Button type="submit" disabled={save.isPending || (touched && !valid)}>
          {save.isPending && <Spinner />}
          {detail ? t("saveChanges") : t("skillEditor.createSkill")}
        </Button>
      </div>
    </form>
  );
}

/** In-pane editor for a new skill (`name` omitted) or an existing one. */
export function SkillEditor({
  bridge,
  name,
  onDone,
}: {
  bridge: DesktopBridge;
  name?: string;
  onDone: () => void;
}) {
  const { t } = useTranslation(["extensions", "common"]);
  const detail = useQuery({ ...skillQuery(bridge, name ?? ""), enabled: name !== undefined });
  useSettingsSubPage(name ?? t("skills.newSkill"));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-2">
        <Button variant="ghost" size="icon-sm" aria-label={t("skillEditor.back")} onClick={onDone}>
          <ArrowLeftIcon />
        </Button>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-heading text-base font-medium">
            {name ? t("skillEditor.editTitle", { name }) : t("skills.newSkill")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("skillEditor.intro")}</p>
        </div>
      </header>
      {name === undefined ? (
        <SkillForm bridge={bridge} onDone={onDone} />
      ) : detail.isPending ? (
        <Spinner />
      ) : detail.isError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("skillEditor.openError")}</AlertTitle>
          <AlertDescription>{detail.error.message}</AlertDescription>
        </Alert>
      ) : (
        <SkillForm key={detail.data.name} bridge={bridge} detail={detail.data} onDone={onDone} />
      )}
    </div>
  );
}
