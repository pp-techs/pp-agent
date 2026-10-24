import * as React from "react";
import {
  DEFAULT_WORKSPACE_ID,
  THINKING_LEVELS,
  type DesktopBridge,
  type ModelRef,
  type ThinkingLevel,
  type WorkspaceProfile,
} from "@workspace/shared";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
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
import { Textarea } from "@workspace/ui/components/textarea";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, FolderOpenIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { OptionGroup } from "@/components/settings/option-group";
import { useSettingsSubPage } from "@/components/settings/settings-subpage";
import { useSaveWorkspace } from "@/lib/extension-queries";
import { groupByProvider, modelKey, modelLabeler } from "@/lib/models";
import { agentsQuery, modelsQuery, workspacesQuery } from "@/lib/queries";

const NAME_MAX = 60;
const ICON_MAX = 8;
const DEFAULT_ICON = "📁";
const INSTRUCTIONS_MAX = 20000;
const ICON_PICKS = ["📁", "💼", "📊", "📝", "🧾", "📈", "🧑‍💼", "🛠️", "📚", "🏠"];

/** Select value for "nothing set here: use the usual default". */
const INHERIT = "inherit";

function FolderField({
  bridge,
  value,
  fixed,
  invalid,
  onChange,
}: {
  bridge: DesktopBridge;
  value: string | null;
  /** The folder of an existing workspace cannot change: its chats belong to the workspace by it. */
  fixed: boolean;
  invalid: boolean;
  onChange: (dir: string) => void;
}) {
  const { t } = useTranslation("agents");

  async function onChoose() {
    try {
      const dir = await bridge.files.pickFolder();
      if (dir) onChange(dir);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <OptionGroup
      legend={t("workspaceEditor.folder.legend")}
      description={
        fixed
          ? t("workspaceEditor.folder.descriptionFixed")
          : t("workspaceEditor.folder.descriptionNew")
      }
    >
      <div className="flex items-center gap-3 rounded-xl bg-muted/50 py-1.5 pr-1.5 pl-3">
        <FolderOpenIcon className="size-4 shrink-0 text-muted-foreground" />
        <span
          className={`min-w-0 flex-1 truncate ${value ? "font-mono text-xs" : "text-sm text-muted-foreground"}`}
          title={value ?? undefined}
        >
          {value ??
            (fixed ? t("workspacesSection.defaultFolder") : t("workspaceEditor.folder.none"))}
        </span>
        {!fixed && (
          <Button type="button" variant="outline" size="sm" onClick={() => void onChoose()}>
            {t("workspaceEditor.folder.choose")}
          </Button>
        )}
      </div>
      {invalid && <FieldError>{t("workspaceEditor.folder.required")}</FieldError>}
    </OptionGroup>
  );
}

function WorkspaceForm({
  bridge,
  workspace,
  workspaces,
  onDone,
}: {
  bridge: DesktopBridge;
  /** Workspace being edited; undefined when creating one. */
  workspace?: WorkspaceProfile;
  workspaces: WorkspaceProfile[];
  onDone: () => void;
}) {
  const [name, setName] = React.useState(workspace?.name ?? "");
  const [icon, setIcon] = React.useState(workspace?.icon ?? DEFAULT_ICON);
  const [dir, setDir] = React.useState(workspace?.dir ?? null);
  const [instructions, setInstructions] = React.useState(workspace?.instructions ?? "");
  const [agentId, setAgentId] = React.useState(workspace?.agentId ?? null);
  const [model, setModel] = React.useState<ModelRef | null>(workspace?.model ?? null);
  const [thinkingLevel, setThinkingLevel] = React.useState(workspace?.thinkingLevel ?? null);
  const [touched, setTouched] = React.useState(false);
  const { t, i18n } = useTranslation(["agents", "common"]);
  const save = useSaveWorkspace(bridge);
  const agents = useQuery(agentsQuery(bridge));
  const models = useQuery(modelsQuery(bridge));
  const isDefault = workspace?.id === DEFAULT_WORKSPACE_ID;
  const fixedFolder = workspace !== undefined;

  const trimmedName = name.trim();
  const nameTaken = workspaces.some(
    (other) => other.id !== workspace?.id && other.name.toLowerCase() === trimmedName.toLowerCase(),
  );
  const errors = {
    name: !trimmedName
      ? t("workspaceEditor.errors.nameRequired")
      : trimmedName.length > NAME_MAX
        ? t("shared.maxChars", { max: NAME_MAX })
        : nameTaken
          ? t("workspaceEditor.errors.nameTaken")
          : null,
    dir: !fixedFolder && !dir,
    instructions:
      instructions.length > INSTRUCTIONS_MAX
        ? t("shared.maxChars", { max: INSTRUCTIONS_MAX.toLocaleString(i18n.language) })
        : null,
  };
  const valid = !errors.name && !errors.dir && !errors.instructions;

  const agentItems = [
    { value: INHERIT, label: t("workspaceEditor.defaults.agentInherit") },
    ...(agents.data ?? []).map((agent) => ({
      value: agent.id,
      label: `${agent.icon} ${agent.name}`,
    })),
  ];
  const available = models.data ?? [];
  const label = modelLabeler(available);
  const modelValue = model ? modelKey(model) : INHERIT;
  const modelMissing = model !== null && !available.some((item) => modelKey(item) === modelValue);
  const modelItems = [
    { value: INHERIT, label: t("workspaceEditor.defaults.modelInherit") },
    ...(modelMissing && model
      ? [{ value: modelValue, label: t("shared.modelUnavailable", { modelId: model.modelId }) }]
      : []),
    ...available.map((item) => ({
      value: modelKey(item),
      label: `${label(item)} · ${item.providerName}`,
    })),
  ];
  const thinkingItems = [
    { value: INHERIT, label: t("workspaceEditor.defaults.thinkingInherit") },
    ...THINKING_LEVELS.map((level) => ({
      value: level,
      label: t(`workspaceEditor.thinkingLevels.${level}`),
    })),
  ];

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (!valid) return;
    save.mutate(
      {
        id: workspace?.id,
        name: trimmedName,
        icon: icon.trim() || DEFAULT_ICON,
        dir,
        instructions: instructions.trim(),
        agentId,
        model,
        thinkingLevel,
      },
      {
        onSuccess: (saved) => {
          toast.success(t("workspaceEditor.saved", { name: saved.name }));
          onDone();
        },
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <FieldGroup>
        <div className="flex items-start gap-3">
          <Field className="w-20 shrink-0">
            <FieldLabel htmlFor="workspace-icon">{t("shared.icon")}</FieldLabel>
            <Input
              id="workspace-icon"
              value={icon}
              onChange={(event) => setIcon(event.target.value)}
              maxLength={ICON_MAX}
              autoComplete="off"
              className="text-center text-lg"
            />
          </Field>
          <Field data-invalid={touched && Boolean(errors.name)}>
            <FieldLabel htmlFor="workspace-name">{t("shared.name")}</FieldLabel>
            <Input
              id="workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("workspaceEditor.namePlaceholder")}
              maxLength={NAME_MAX}
              autoComplete="off"
              aria-invalid={touched && Boolean(errors.name)}
            />
            {touched && errors.name && <FieldError>{errors.name}</FieldError>}
          </Field>
        </div>
        <div
          className="-mt-4 flex flex-wrap gap-1"
          role="group"
          aria-label={t("shared.quickIconPicks")}
        >
          {ICON_PICKS.map((pick) => (
            <Button
              key={pick}
              type="button"
              variant={icon === pick ? "secondary" : "ghost"}
              size="icon-sm"
              aria-label={t("shared.useAsIcon", { icon: pick })}
              aria-pressed={icon === pick}
              className="text-base"
              onClick={() => setIcon(pick)}
            >
              {pick}
            </Button>
          ))}
        </div>
        <FolderField
          bridge={bridge}
          value={dir}
          fixed={fixedFolder}
          invalid={touched && errors.dir}
          onChange={setDir}
        />
        <Field data-invalid={touched && Boolean(errors.instructions)}>
          <FieldLabel htmlFor="workspace-instructions">{t("shared.instructions")}</FieldLabel>
          <Textarea
            id="workspace-instructions"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder={t("workspaceEditor.instructions.placeholder")}
            aria-invalid={touched && Boolean(errors.instructions)}
            className="min-h-40 resize-y"
          />
          {touched && errors.instructions ? (
            <FieldError>{errors.instructions}</FieldError>
          ) : (
            <FieldDescription>{t("workspaceEditor.instructions.help")}</FieldDescription>
          )}
        </Field>
        <OptionGroup
          legend={t("workspaceEditor.defaults.legend")}
          description={t("workspaceEditor.defaults.description")}
        >
          <Field>
            <FieldLabel htmlFor="workspace-agent">{t("workspaceEditor.defaults.agent")}</FieldLabel>
            <Select
              items={agentItems}
              value={agentId ?? INHERIT}
              onValueChange={(next) => next !== null && setAgentId(next === INHERIT ? null : next)}
            >
              <SelectTrigger id="workspace-agent" className="w-full" disabled={agents.isPending}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {agentItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="workspace-model">{t("shared.model")}</FieldLabel>
            <Select
              items={modelItems}
              value={modelValue}
              onValueChange={(next) => {
                if (next === null || next === modelValue) return;
                const picked = available.find((item) => modelKey(item) === next);
                setModel(picked ? { provider: picked.provider, modelId: picked.modelId } : null);
              }}
            >
              <SelectTrigger id="workspace-model" className="w-full" disabled={models.isPending}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={INHERIT}>
                  {t("workspaceEditor.defaults.modelInherit")}
                </SelectItem>
                {modelMissing && model && (
                  <SelectItem value={modelValue} disabled>
                    {t("shared.modelUnavailable", { modelId: model.modelId })}
                  </SelectItem>
                )}
                {groupByProvider(available).map(([provider, group]) => (
                  <SelectGroup key={provider}>
                    <SelectLabel>{group.name}</SelectLabel>
                    {group.models.map((item) => (
                      <SelectItem
                        key={modelKey(item)}
                        value={modelKey(item)}
                        disabled={item.needsKey}
                      >
                        {item.needsKey
                          ? t("shared.modelNeedsKey", { name: label(item) })
                          : label(item)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>{t("workspaceEditor.defaults.modelHelp")}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="workspace-thinking">
              {t("workspaceEditor.defaults.thinking")}
            </FieldLabel>
            <Select
              items={thinkingItems}
              value={thinkingLevel ?? INHERIT}
              onValueChange={(next) =>
                next !== null && setThinkingLevel(next === INHERIT ? null : (next as ThinkingLevel))
              }
            >
              <SelectTrigger id="workspace-thinking" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {thinkingItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </OptionGroup>
      </FieldGroup>
      {save.isError && <FieldError>{save.error.message}</FieldError>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common:actions.cancel")}
        </Button>
        <Button type="submit" disabled={save.isPending || (touched && !valid)}>
          {save.isPending && <Spinner />}
          {workspace ? t("shared.saveChanges") : t("workspaceEditor.create")}
        </Button>
      </div>
      {isDefault && <span className="sr-only">{t("workspaceEditor.builtInSrOnly")}</span>}
    </form>
  );
}

/** In-pane editor for a new workspace (`id` omitted) or an existing one. */
export function WorkspaceEditor({
  bridge,
  id,
  onDone,
}: {
  bridge: DesktopBridge;
  id?: string;
  onDone: () => void;
}) {
  const { t } = useTranslation("agents");
  const workspaces = useQuery(workspacesQuery(bridge));
  const workspace = workspaces.data?.find((item) => item.id === id);
  useSettingsSubPage(
    id === undefined
      ? t("workspaceEditor.newTitle")
      : (workspace?.name ?? t("workspaceEditor.editTitle")),
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("workspaceEditor.backToWorkspaces")}
          onClick={onDone}
        >
          <ArrowLeftIcon />
        </Button>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-heading text-base font-medium">
            {id === undefined
              ? t("workspaceEditor.newTitle")
              : workspace
                ? t("workspaceEditor.editNamed", { name: workspace.name })
                : t("workspaceEditor.editTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {id === DEFAULT_WORKSPACE_ID
              ? t("workspaceEditor.subtitleBuiltIn")
              : t("workspaceEditor.subtitle")}
          </p>
        </div>
      </header>
      {workspaces.isPending ? (
        <Spinner />
      ) : workspaces.isError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("workspaceEditor.openError")}</AlertTitle>
          <AlertDescription>{workspaces.error.message}</AlertDescription>
        </Alert>
      ) : id !== undefined && !workspace ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("workspaceEditor.notFound.title")}</AlertTitle>
          <AlertDescription>{t("workspaceEditor.notFound.description")}</AlertDescription>
        </Alert>
      ) : (
        <WorkspaceForm
          key={workspace?.id ?? "new"}
          bridge={bridge}
          workspace={workspace}
          workspaces={workspaces.data}
          onDone={onDone}
        />
      )}
    </div>
  );
}
