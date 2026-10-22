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
import { ArrowLeftIcon, FileIcon, FolderOpenIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { useSettingsSubPage } from "@/components/settings/settings-subpage";
import { skillQuery, useSaveSkill } from "@/lib/extension-queries";

const NAME_MAX = 64;
const DESCRIPTION_MAX = 1024;

const BODY_PLACEHOLDER = `# Weekly sales summary

1. Read the sales export the person points to.
2. Group the totals by region and by product.
3. Write a short summary with the three biggest changes since last week.`;

function nameError(name: string) {
  if (!name) return "Give the skill a name.";
  if (name.length > NAME_MAX) return `Use at most ${NAME_MAX} characters.`;
  if (!/^[a-z0-9-]+$/.test(name)) return "Use only lowercase letters, digits, and hyphens (-).";
  return null;
}

function descriptionError(description: string) {
  if (!description) return "Describe what the skill does and when to use it.";
  if (description.length > DESCRIPTION_MAX) return `Use at most ${DESCRIPTION_MAX} characters.`;
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
  const [name, setName] = React.useState(detail?.name ?? "");
  const [description, setDescription] = React.useState(detail?.description ?? "");
  const [modelInvocable, setModelInvocable] = React.useState(detail?.modelInvocable ?? true);
  const [body, setBody] = React.useState(detail?.body ?? "");
  const [touched, setTouched] = React.useState(false);
  const save = useSaveSkill(bridge);

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const errors = {
    name: nameError(trimmedName),
    description: descriptionError(trimmedDescription),
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
          toast.success(`Skill “${skill.name}” saved`);
          onDone();
        },
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <FieldGroup>
        <Field data-invalid={touched && Boolean(errors.name)}>
          <FieldLabel htmlFor="skill-name">Name</FieldLabel>
          <Input
            id="skill-name"
            value={name}
            // Lowercase and hyphenate as people type ("Sales Report" → "sales-report").
            onChange={(event) => setName(event.target.value.toLowerCase().replace(/\s+/g, "-"))}
            placeholder="weekly-sales-summary"
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
              Lowercase letters, digits, and hyphens. Use it in a chat by typing{" "}
              <Kbd className="font-mono">/skill:{trimmedName || "name"}</Kbd>.
            </FieldDescription>
          )}
        </Field>
        <Field data-invalid={touched && Boolean(errors.description)}>
          <FieldLabel htmlFor="skill-description">Description</FieldLabel>
          <Textarea
            id="skill-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Summarises a weekly sales export by region and product. Use when someone asks for a sales summary or weekly numbers."
            maxLength={DESCRIPTION_MAX}
            aria-invalid={touched && Boolean(errors.description)}
            className="min-h-20"
          />
          {touched && errors.description ? (
            <FieldError>{errors.description}</FieldError>
          ) : (
            <FieldDescription>
              Say what it does and when to use it. The agent reads this to decide when the skill
              fits. {description.length}/{DESCRIPTION_MAX}
            </FieldDescription>
          )}
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="skill-auto">Let the agent use this automatically</FieldLabel>
            <FieldDescription>
              When off, the skill only runs when someone types /skill:{trimmedName || "name"}.
            </FieldDescription>
          </FieldContent>
          <Switch id="skill-auto" checked={modelInvocable} onCheckedChange={setModelInvocable} />
        </Field>
        <Field>
          <FieldLabel htmlFor="skill-body">Instructions</FieldLabel>
          <Textarea
            id="skill-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={BODY_PLACEHOLDER}
            spellCheck={false}
            className="min-h-80 resize-y font-mono text-xs md:text-xs"
          />
          <FieldDescription>
            Step-by-step instructions for the agent, written in Markdown.
          </FieldDescription>
        </Field>
        {detail && detail.files.length > 0 && (
          <Field>
            <FieldLabel>Other files in this skill</FieldLabel>
            <ul className="flex flex-col gap-1 rounded-xl bg-muted/50 p-3">
              {detail.files.map((file) => (
                <li key={file} className="flex items-center gap-2 font-mono text-xs">
                  <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{file}</span>
                </li>
              ))}
            </ul>
            <FieldDescription className="flex flex-wrap items-center gap-2">
              The agent can open these when it follows the instructions. Change them in the skill
              folder.
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
                Show in folder
              </Button>
            </FieldDescription>
          </Field>
        )}
      </FieldGroup>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending || (touched && !valid)}>
          {save.isPending && <Spinner />}
          {detail ? "Save changes" : "Create skill"}
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
  const detail = useQuery({ ...skillQuery(bridge, name ?? ""), enabled: name !== undefined });
  useSettingsSubPage(name ?? "New skill");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Back to skills" onClick={onDone}>
          <ArrowLeftIcon />
        </Button>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-heading text-base font-medium">
            {name ? `Edit “${name}”` : "New skill"}
          </h2>
          <p className="text-sm text-muted-foreground">
            A skill is a set of instructions the agent follows for a specific kind of task.
          </p>
        </div>
      </header>
      {name === undefined ? (
        <SkillForm bridge={bridge} onDone={onDone} />
      ) : detail.isPending ? (
        <Spinner />
      ) : detail.isError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Couldn't open this skill</AlertTitle>
          <AlertDescription>{detail.error.message}</AlertDescription>
        </Alert>
      ) : (
        <SkillForm key={detail.data.name} bridge={bridge} detail={detail.data} onDone={onDone} />
      )}
    </div>
  );
}
