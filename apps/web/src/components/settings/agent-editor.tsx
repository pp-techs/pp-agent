import * as React from "react";
import {
  DEFAULT_AGENT_ID,
  type AgentProfile,
  type DesktopBridge,
  type ModelRef,
} from "@workspace/shared";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Field,
  FieldContent,
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
import { ArrowLeftIcon, PlusIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { OptionGroup, SubOptions, SwitchRow } from "@/components/settings/option-group";
import { useSettingsSubPage } from "@/components/settings/settings-subpage";
import {
  agentToolOptionsQuery,
  mcpQuery,
  skillsQuery,
  useSaveAgent,
} from "@/lib/extension-queries";
import { groupByProvider, modelKey, modelLabeler } from "@/lib/models";
import { agentsQuery, modelsQuery } from "@/lib/queries";

const NAME_MAX = 60;
const ICON_MAX = 8;
const DEFAULT_ICON = "🤖";
const INSTRUCTIONS_MAX = 20000;
const STARTERS_MAX = 20;
const STARTER_MAX = 300;
const ICON_PICKS = ["🤖", "📊", "📝", "💼", "📈", "🧾", "🧑‍💼", "🛠️", "📚", "💬"];

/** Select value for "no model of its own". */
const KEEP_MODEL = "keep";

/** Agent tools whose label and description are translated in the `agents` namespace. */
const TOOL_OPTION_NAMES = [
  "read",
  "ls",
  "find",
  "grep",
  "read_document",
  "current_datetime",
  "web_search",
  "web_fetch",
  "write",
  "edit",
  "bash",
  "powershell",
] as const;
type ToolOptionName = (typeof TOOL_OPTION_NAMES)[number];

/** Unknown tools (not in the list) keep the backend's English text. */
const isToolOptionName = (name: string): name is ToolOptionName =>
  (TOOL_OPTION_NAMES as readonly string[]).includes(name);

interface ChecklistOption {
  name: string;
  label: string;
  description?: string;
  /** Why the option may not work right now, for example "Off in Settings › Tools". */
  hint?: string;
}

/**
 * "All" switch plus a checklist. `selected` null means everything, including what is added later.
 * Names that are not among the options (removed, or not installed yet) stay listed so they can be
 * unticked.
 */
function ChecklistField({
  id,
  legend,
  description,
  allLabel,
  allDescription,
  options,
  loading,
  error,
  emptyText,
  selected,
  onChange,
}: {
  id: string;
  legend: string;
  description: string;
  allLabel: string;
  allDescription: string;
  options: ChecklistOption[];
  loading: boolean;
  error: string | null;
  emptyText: string;
  selected: string[] | null;
  onChange: (selected: string[] | null) => void;
}) {
  const { t } = useTranslation("agents");
  const known = new Set(options.map((option) => option.name));
  const rows: ChecklistOption[] = [
    ...options,
    ...(selected ?? [])
      .filter((name) => !known.has(name))
      .map((name) => ({ name, label: name, hint: t("agentEditor.checklist.notInstalled") })),
  ];
  const chosen = new Set(selected ?? []);

  function toggle(name: string, checked: boolean) {
    const current = selected ?? [];
    onChange(checked ? [...current, name] : current.filter((item) => item !== name));
  }

  return (
    <OptionGroup legend={legend} description={description}>
      <SwitchRow
        id={`${id}-all`}
        label={allLabel}
        description={allDescription}
        checked={selected === null}
        onCheckedChange={(all) => onChange(all ? null : options.map((option) => option.name))}
      />
      {selected !== null && (
        <SubOptions>
          {loading ? (
            <Spinner />
          ) : error ? (
            <FieldError>{error}</FieldError>
          ) : rows.length === 0 ? (
            <FieldDescription className="text-xs">{emptyText}</FieldDescription>
          ) : (
            rows.map((option) => {
              const checkboxId = `${id}-${option.name}`;
              return (
                <Field key={option.name} orientation="horizontal" className="gap-2.5">
                  <Checkbox
                    id={checkboxId}
                    checked={chosen.has(option.name)}
                    onCheckedChange={(checked) => toggle(option.name, checked)}
                  />
                  <FieldContent className="min-w-0 gap-0.5">
                    <FieldLabel htmlFor={checkboxId} className="flex-wrap text-sm font-normal">
                      {option.label}
                      {option.hint && (
                        <span className="text-xs text-muted-foreground">· {option.hint}</span>
                      )}
                    </FieldLabel>
                    {option.description && (
                      <FieldDescription className="line-clamp-2 text-xs">
                        {option.description}
                      </FieldDescription>
                    )}
                  </FieldContent>
                </Field>
              );
            })
          )}
        </SubOptions>
      )}
    </OptionGroup>
  );
}

function ModelField({
  bridge,
  value,
  onChange,
}: {
  bridge: DesktopBridge;
  value: ModelRef | null;
  onChange: (model: ModelRef | null) => void;
}) {
  const { t } = useTranslation("agents");
  const models = useQuery(modelsQuery(bridge));
  const available = models.data ?? [];
  const label = modelLabeler(available);
  const currentKey = value ? modelKey(value) : KEEP_MODEL;
  const missing = value !== null && !available.some((model) => modelKey(model) === currentKey);
  const items = [
    { value: KEEP_MODEL, label: t("agentEditor.model.keep") },
    ...(missing && value
      ? [{ value: currentKey, label: t("shared.modelUnavailable", { modelId: value.modelId }) }]
      : []),
    ...available.map((model) => ({
      value: modelKey(model),
      label: `${label(model)} · ${model.providerName}`,
    })),
  ];

  function onSelect(next: string | null) {
    if (next === null || next === currentKey) return;
    const model = available.find((item) => modelKey(item) === next);
    onChange(model ? { provider: model.provider, modelId: model.modelId } : null);
  }

  return (
    <OptionGroup legend={t("shared.model")} description={t("agentEditor.model.description")}>
      <Select items={items} value={currentKey} onValueChange={onSelect}>
        <SelectTrigger
          className="w-full"
          aria-label={t("shared.model")}
          disabled={models.isPending}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={KEEP_MODEL}>{t("agentEditor.model.keep")}</SelectItem>
          {missing && value && (
            <SelectItem value={currentKey} disabled>
              {t("shared.modelUnavailable", { modelId: value.modelId })}
            </SelectItem>
          )}
          {groupByProvider(available).map(([provider, group]) => (
            <SelectGroup key={provider}>
              <SelectLabel>{group.name}</SelectLabel>
              {group.models.map((model) => (
                <SelectItem key={modelKey(model)} value={modelKey(model)}>
                  {label(model)}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </OptionGroup>
  );
}

function StarterPromptsField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (prompts: string[]) => void;
}) {
  const { t } = useTranslation("agents");
  return (
    <OptionGroup
      legend={t("agentEditor.starterPrompts.legend")}
      description={t("agentEditor.starterPrompts.description")}
    >
      {value.map((prompt, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            aria-label={t("agentEditor.starterPrompts.inputLabel", { number: index + 1 })}
            value={prompt}
            maxLength={STARTER_MAX}
            placeholder={t("agentEditor.starterPrompts.placeholder")}
            onChange={(event) =>
              onChange(value.map((item, at) => (at === index ? event.target.value : item)))
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("agentEditor.starterPrompts.remove", { number: index + 1 })}
            onClick={() => onChange(value.filter((_, at) => at !== index))}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={value.length >= STARTERS_MAX}
          onClick={() => onChange([...value, ""])}
        >
          <PlusIcon data-icon="inline-start" />
          {t("agentEditor.starterPrompts.add")}
        </Button>
      </div>
    </OptionGroup>
  );
}

function AgentForm({
  bridge,
  agent,
  agents,
  onDone,
}: {
  bridge: DesktopBridge;
  /** Agent being edited; undefined when creating one. */
  agent?: AgentProfile;
  agents: AgentProfile[];
  onDone: () => void;
}) {
  const [name, setName] = React.useState(agent?.name ?? "");
  const [icon, setIcon] = React.useState(agent?.icon ?? DEFAULT_ICON);
  const [description, setDescription] = React.useState(agent?.description ?? "");
  const [instructions, setInstructions] = React.useState(agent?.instructions ?? "");
  const [model, setModel] = React.useState<ModelRef | null>(agent?.model ?? null);
  const [tools, setTools] = React.useState(agent?.tools ?? null);
  const [mcpServers, setMcpServers] = React.useState(agent?.mcpServers ?? null);
  const [skills, setSkills] = React.useState(agent?.skills ?? null);
  const [starterPrompts, setStarterPrompts] = React.useState(agent?.starterPrompts ?? []);
  const [touched, setTouched] = React.useState(false);
  const { t, i18n } = useTranslation(["agents", "common"]);
  const save = useSaveAgent(bridge);
  const toolOptions = useQuery(agentToolOptionsQuery(bridge));
  const mcp = useQuery(mcpQuery(bridge));
  const skillList = useQuery(skillsQuery(bridge));

  const trimmedName = name.trim();
  const nameTaken = agents.some(
    (other) => other.id !== agent?.id && other.name.toLowerCase() === trimmedName.toLowerCase(),
  );
  const errors = {
    name: !trimmedName
      ? t("agentEditor.errors.nameRequired")
      : trimmedName.length > NAME_MAX
        ? t("shared.maxChars", { max: NAME_MAX })
        : nameTaken
          ? t("agentEditor.errors.nameTaken")
          : null,
    instructions:
      instructions.length > INSTRUCTIONS_MAX
        ? t("shared.maxChars", { max: INSTRUCTIONS_MAX.toLocaleString(i18n.language) })
        : null,
  };
  const valid = !errors.name && !errors.instructions;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (!valid) return;
    save.mutate(
      {
        id: agent?.id,
        name: trimmedName,
        icon: icon.trim() || DEFAULT_ICON,
        description: description.trim(),
        instructions: instructions.trim(),
        tools,
        mcpServers,
        skills,
        model,
        starterPrompts: starterPrompts.map((prompt) => prompt.trim()).filter(Boolean),
      },
      {
        onSuccess: (saved) => {
          toast.success(t("agentEditor.saved", { name: saved.name }));
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
            <FieldLabel htmlFor="agent-icon">{t("shared.icon")}</FieldLabel>
            <Input
              id="agent-icon"
              value={icon}
              onChange={(event) => setIcon(event.target.value)}
              maxLength={ICON_MAX}
              autoComplete="off"
              className="text-center text-lg"
            />
          </Field>
          <Field data-invalid={touched && Boolean(errors.name)}>
            <FieldLabel htmlFor="agent-name">{t("shared.name")}</FieldLabel>
            <Input
              id="agent-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("agentEditor.fields.namePlaceholder")}
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
        <Field>
          <FieldLabel htmlFor="agent-description">
            {t("agentEditor.fields.description.label")}
          </FieldLabel>
          <Textarea
            id="agent-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("agentEditor.fields.description.placeholder")}
            className="min-h-16"
          />
          <FieldDescription>{t("agentEditor.fields.description.help")}</FieldDescription>
        </Field>
        <Field data-invalid={touched && Boolean(errors.instructions)}>
          <FieldLabel htmlFor="agent-instructions">{t("shared.instructions")}</FieldLabel>
          <Textarea
            id="agent-instructions"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder={t("agentEditor.fields.instructions.placeholder")}
            aria-invalid={touched && Boolean(errors.instructions)}
            className="min-h-60 resize-y"
          />
          {touched && errors.instructions ? (
            <FieldError>{errors.instructions}</FieldError>
          ) : (
            <FieldDescription>{t("agentEditor.fields.instructions.help")}</FieldDescription>
          )}
        </Field>
        <ModelField bridge={bridge} value={model} onChange={setModel} />
        <ChecklistField
          id="agent-tools"
          legend={t("agentEditor.tools.legend")}
          description={t("agentEditor.tools.description")}
          allLabel={t("agentEditor.tools.allLabel")}
          allDescription={t("agentEditor.tools.allDescription")}
          options={(toolOptions.data ?? []).map((tool) => ({
            name: tool.name,
            label: isToolOptionName(tool.name) ? t(`toolOptions.${tool.name}.label`) : tool.label,
            description: isToolOptionName(tool.name)
              ? t(`toolOptions.${tool.name}.description`)
              : tool.description,
            hint: tool.globallyOff ? t("agentEditor.tools.off") : undefined,
          }))}
          loading={toolOptions.isPending}
          error={toolOptions.error?.message ?? null}
          emptyText={t("agentEditor.tools.empty")}
          selected={tools}
          onChange={setTools}
        />
        <ChecklistField
          id="agent-mcp"
          legend={t("agentEditor.mcp.legend")}
          description={t("agentEditor.mcp.description")}
          allLabel={t("agentEditor.mcp.allLabel")}
          allDescription={t("agentEditor.mcp.allDescription")}
          options={(mcp.data?.servers ?? []).map((server) => ({
            name: server.settings.name,
            label: server.settings.name,
            description: server.settings.description,
            hint: server.settings.enabled ? undefined : t("agentEditor.mcp.off"),
          }))}
          loading={mcp.isPending}
          error={mcp.error?.message ?? null}
          emptyText={t("agentEditor.mcp.empty")}
          selected={mcpServers}
          onChange={setMcpServers}
        />
        <ChecklistField
          id="agent-skills"
          legend={t("agentEditor.skills.legend")}
          description={t("agentEditor.skills.description")}
          allLabel={t("agentEditor.skills.allLabel")}
          allDescription={t("agentEditor.skills.allDescription")}
          options={(skillList.data ?? []).map((skill) => ({
            name: skill.name,
            label: skill.name,
            description: skill.description,
            hint: skill.enabled ? undefined : t("agentEditor.skills.off"),
          }))}
          loading={skillList.isPending}
          error={skillList.error?.message ?? null}
          emptyText={t("agentEditor.skills.empty")}
          selected={skills}
          onChange={setSkills}
        />
        <StarterPromptsField value={starterPrompts} onChange={setStarterPrompts} />
      </FieldGroup>
      {save.isError && <FieldError>{save.error.message}</FieldError>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common:actions.cancel")}
        </Button>
        <Button type="submit" disabled={save.isPending || (touched && !valid)}>
          {save.isPending && <Spinner />}
          {agent ? t("shared.saveChanges") : t("agentEditor.create")}
        </Button>
      </div>
    </form>
  );
}

/** In-pane editor for a new agent (`id` omitted) or an existing one. */
export function AgentEditor({
  bridge,
  id,
  onDone,
}: {
  bridge: DesktopBridge;
  id?: string;
  onDone: () => void;
}) {
  const { t } = useTranslation("agents");
  const agents = useQuery(agentsQuery(bridge));
  const agent = agents.data?.find((item) => item.id === id);
  useSettingsSubPage(
    id === undefined ? t("agentEditor.newTitle") : (agent?.name ?? t("agentEditor.editTitle")),
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("agentEditor.backToAgents")}
          onClick={onDone}
        >
          <ArrowLeftIcon />
        </Button>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-heading text-base font-medium">
            {id === undefined
              ? t("agentEditor.newTitle")
              : agent
                ? t("agentEditor.editNamed", { name: agent.name })
                : t("agentEditor.editTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {id === DEFAULT_AGENT_ID ? t("agentEditor.subtitleDefault") : t("agentEditor.subtitle")}
          </p>
        </div>
      </header>
      {agents.isPending ? (
        <Spinner />
      ) : agents.isError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("agentEditor.openError")}</AlertTitle>
          <AlertDescription>{agents.error.message}</AlertDescription>
        </Alert>
      ) : id !== undefined && !agent ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("agentEditor.notFound.title")}</AlertTitle>
          <AlertDescription>{t("agentEditor.notFound.description")}</AlertDescription>
        </Alert>
      ) : (
        <AgentForm
          key={agent?.id ?? "new"}
          bridge={bridge}
          agent={agent}
          agents={agents.data}
          onDone={onDone}
        />
      )}
    </div>
  );
}
