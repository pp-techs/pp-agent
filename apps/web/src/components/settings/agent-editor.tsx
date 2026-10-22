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
import { ArrowLeftIcon, FolderOpenIcon, PlusIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { OptionGroup, SubOptions, SwitchRow } from "@/components/settings/option-group";
import { useSettingsSubPage } from "@/components/settings/settings-subpage";
import {
  agentToolOptionsQuery,
  mcpQuery,
  skillsQuery,
  useSaveAgent,
} from "@/lib/extension-queries";
import { groupByProvider, modelKey } from "@/lib/models";
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

const INSTRUCTIONS_PLACEHOLDER = `You help the finance team close the month.
- Answer in short bullet points.
- Always say which file a number comes from.
- Never change the original spreadsheets; save results as new files.`;

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
  const known = new Set(options.map((option) => option.name));
  const rows: ChecklistOption[] = [
    ...options,
    ...(selected ?? [])
      .filter((name) => !known.has(name))
      .map((name) => ({ name, label: name, hint: "Not installed" })),
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
  const models = useQuery(modelsQuery(bridge));
  const available = models.data ?? [];
  const currentKey = value ? modelKey(value) : KEEP_MODEL;
  const missing = value !== null && !available.some((model) => modelKey(model) === currentKey);
  const items = [
    { value: KEEP_MODEL, label: "Keep the chat's model" },
    ...(missing && value ? [{ value: currentKey, label: `${value.modelId} (not available)` }] : []),
    ...available.map((model) => ({
      value: modelKey(model),
      label: `${model.name} · ${model.providerName}`,
    })),
  ];

  function onSelect(next: string | null) {
    if (next === null || next === currentKey) return;
    const model = available.find((item) => modelKey(item) === next);
    onChange(model ? { provider: model.provider, modelId: model.modelId } : null);
  }

  return (
    <OptionGroup
      legend="Model"
      description="When you pick this agent, the chat switches to this model. New chats with it start on it."
    >
      <Select items={items} value={currentKey} onValueChange={onSelect}>
        <SelectTrigger className="w-full" aria-label="Model" disabled={models.isPending}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={KEEP_MODEL}>Keep the chat's model</SelectItem>
          {missing && value && (
            <SelectItem value={currentKey} disabled>
              {value.modelId} (not available)
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
    </OptionGroup>
  );
}

function WorkspaceField({
  bridge,
  value,
  onChange,
}: {
  bridge: DesktopBridge;
  value: string | null;
  onChange: (dir: string | null) => void;
}) {
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
      legend="Workspace folder"
      description="Where the agent works. Files it saves go there."
    >
      <div className="flex items-center gap-3 rounded-xl bg-muted/50 py-1.5 pr-1.5 pl-3">
        <FolderOpenIcon className="size-4 shrink-0 text-muted-foreground" />
        <span
          className={`min-w-0 flex-1 truncate ${value ? "font-mono text-xs" : "text-sm text-muted-foreground"}`}
          title={value ?? undefined}
        >
          {value ?? "The app's default workspace folder"}
        </span>
        <div className="flex shrink-0 gap-1">
          {value && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              Use default
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => void onChoose()}>
            Choose…
          </Button>
        </div>
      </div>
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
  return (
    <OptionGroup
      legend="Starter prompts"
      description="Buttons shown on a new chat with this agent. Clicking one sends it right away."
    >
      {value.map((prompt, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            aria-label={`Starter prompt ${index + 1}`}
            value={prompt}
            maxLength={STARTER_MAX}
            placeholder="Summarise this month's expenses by team"
            onChange={(event) =>
              onChange(value.map((item, at) => (at === index ? event.target.value : item)))
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove starter prompt ${index + 1}`}
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
          Add starter prompt
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
  const [workspaceDir, setWorkspaceDir] = React.useState(agent?.workspaceDir ?? null);
  const [tools, setTools] = React.useState(agent?.tools ?? null);
  const [mcpServers, setMcpServers] = React.useState(agent?.mcpServers ?? null);
  const [skills, setSkills] = React.useState(agent?.skills ?? null);
  const [starterPrompts, setStarterPrompts] = React.useState(agent?.starterPrompts ?? []);
  const [touched, setTouched] = React.useState(false);
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
      ? "Give the agent a name."
      : trimmedName.length > NAME_MAX
        ? `Use at most ${NAME_MAX} characters.`
        : nameTaken
          ? "Another agent already has this name."
          : null,
    instructions:
      instructions.length > INSTRUCTIONS_MAX
        ? `Use at most ${INSTRUCTIONS_MAX.toLocaleString()} characters.`
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
        workspaceDir,
      },
      {
        onSuccess: (saved) => {
          toast.success(`Agent “${saved.name}” saved`);
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
            <FieldLabel htmlFor="agent-icon">Icon</FieldLabel>
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
            <FieldLabel htmlFor="agent-name">Name</FieldLabel>
            <Input
              id="agent-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Finance helper"
              maxLength={NAME_MAX}
              autoComplete="off"
              aria-invalid={touched && Boolean(errors.name)}
            />
            {touched && errors.name && <FieldError>{errors.name}</FieldError>}
          </Field>
        </div>
        <div className="-mt-4 flex flex-wrap gap-1" role="group" aria-label="Quick icon picks">
          {ICON_PICKS.map((pick) => (
            <Button
              key={pick}
              type="button"
              variant={icon === pick ? "secondary" : "ghost"}
              size="icon-sm"
              aria-label={`Use ${pick} as the icon`}
              aria-pressed={icon === pick}
              className="text-base"
              onClick={() => setIcon(pick)}
            >
              {pick}
            </Button>
          ))}
        </div>
        <Field>
          <FieldLabel htmlFor="agent-description">Description</FieldLabel>
          <Textarea
            id="agent-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Helps the finance team with month-end reports and expense questions."
            className="min-h-16"
          />
          <FieldDescription>
            Shown in the agent list and at the start of a new chat.
          </FieldDescription>
        </Field>
        <Field data-invalid={touched && Boolean(errors.instructions)}>
          <FieldLabel htmlFor="agent-instructions">Instructions</FieldLabel>
          <Textarea
            id="agent-instructions"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder={INSTRUCTIONS_PLACEHOLDER}
            aria-invalid={touched && Boolean(errors.instructions)}
            className="min-h-60 resize-y"
          />
          {touched && errors.instructions ? (
            <FieldError>{errors.instructions}</FieldError>
          ) : (
            <FieldDescription>
              Rules the agent always follows, e.g. tone, format, what to avoid.
            </FieldDescription>
          )}
        </Field>
        <ModelField bridge={bridge} value={model} onChange={setModel} />
        <WorkspaceField bridge={bridge} value={workspaceDir} onChange={setWorkspaceDir} />
        <ChecklistField
          id="agent-tools"
          legend="Tools"
          description="What the agent can do on this computer. Settings › Tools still decides what needs your approval."
          allLabel="All tools"
          allDescription="Includes tools turned on later."
          options={(toolOptions.data ?? []).map((tool) => ({
            name: tool.name,
            label: tool.label,
            description: tool.description,
            hint: tool.globallyOff ? "Off in Settings › Tools" : undefined,
          }))}
          loading={toolOptions.isPending}
          error={toolOptions.error?.message ?? null}
          emptyText="No tools to choose from."
          selected={tools}
          onChange={setTools}
        />
        <ChecklistField
          id="agent-mcp"
          legend="MCP servers"
          description="Connected services this agent can use."
          allLabel="All servers"
          allDescription="Every server that is turned on, including ones added later."
          options={(mcp.data?.servers ?? []).map((server) => ({
            name: server.settings.name,
            label: server.settings.name,
            description: server.settings.description,
            hint: server.settings.enabled ? undefined : "Off in Settings › MCP servers",
          }))}
          loading={mcp.isPending}
          error={mcp.error?.message ?? null}
          emptyText="No MCP servers yet. Add them in Settings › MCP servers."
          selected={mcpServers}
          onChange={setMcpServers}
        />
        <ChecklistField
          id="agent-skills"
          legend="Skills"
          description="Ready-made instructions this agent can follow."
          allLabel="All skills"
          allDescription="Every skill that is turned on, including ones added later."
          options={(skillList.data ?? []).map((skill) => ({
            name: skill.name,
            label: skill.name,
            description: skill.description,
            hint: skill.enabled ? undefined : "Off in Settings › Skills",
          }))}
          loading={skillList.isPending}
          error={skillList.error?.message ?? null}
          emptyText="No skills yet. Add them in Settings › Skills."
          selected={skills}
          onChange={setSkills}
        />
        <StarterPromptsField value={starterPrompts} onChange={setStarterPrompts} />
      </FieldGroup>
      {save.isError && <FieldError>{save.error.message}</FieldError>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending || (touched && !valid)}>
          {save.isPending && <Spinner />}
          {agent ? "Save changes" : "Create agent"}
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
  const agents = useQuery(agentsQuery(bridge));
  const agent = agents.data?.find((item) => item.id === id);
  useSettingsSubPage(id === undefined ? "New agent" : (agent?.name ?? "Edit agent"));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Back to agents" onClick={onDone}>
          <ArrowLeftIcon />
        </Button>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-heading text-base font-medium">
            {id === undefined ? "New agent" : agent ? `Edit “${agent.name}”` : "Edit agent"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {id === DEFAULT_AGENT_ID
              ? "The built-in agent. You can change it, but not delete it."
              : "An agent is an assistant set up for one kind of work."}
          </p>
        </div>
      </header>
      {agents.isPending ? (
        <Spinner />
      ) : agents.isError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Couldn't open this agent</AlertTitle>
          <AlertDescription>{agents.error.message}</AlertDescription>
        </Alert>
      ) : id !== undefined && !agent ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>This agent no longer exists</AlertTitle>
          <AlertDescription>It may have been deleted. Go back to see your agents.</AlertDescription>
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
