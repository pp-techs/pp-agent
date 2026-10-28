import * as React from "react";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_WORKSPACE_ID,
  SCHEDULE_LIMITS,
  type DesktopBridge,
  type ScheduledTaskView,
  type TaskSchedule,
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Spinner } from "@workspace/ui/components/spinner";
import { Textarea } from "@workspace/ui/components/textarea";
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { OptionGroup, SwitchRow } from "@/components/settings/option-group";
import { WEEKDAY_ORDER, weekdayName } from "@/components/settings/scheduled-task-format";
import { useSettingsSubPage } from "@/components/settings/settings-subpage";
import { scheduledTasksQuery, useScheduledTaskCommands } from "@/lib/extension-queries";
import { agentsQuery, workspacesQuery } from "@/lib/queries";

const KINDS = ["interval", "daily", "weekly"] as const;
type Kind = (typeof KINDS)[number];
const UNITS = ["minutes", "hours"] as const;
type Unit = (typeof UNITS)[number];

const isKind = (value: string | null): value is Kind => KINDS.some((kind) => kind === value);
const isUnit = (value: string | null): value is Unit => UNITS.some((unit) => unit === value);

const DEFAULT_TIME = "09:00";

/** Starting values of the schedule fields for a task being edited (or a new one: every day at 09:00). */
function scheduleFields(schedule: TaskSchedule | undefined) {
  const kind: Kind = schedule && schedule.kind !== "once" ? schedule.kind : "daily";
  return {
    kind,
    every: schedule?.kind === "interval" ? String(schedule.every) : "1",
    unit: schedule?.kind === "interval" ? schedule.unit : "hours",
    time:
      schedule && schedule.kind !== "interval" && schedule.kind !== "once"
        ? schedule.time
        : DEFAULT_TIME,
    days: schedule?.kind === "weekly" ? schedule.days : [1, 2, 3, 4, 5],
  } satisfies { kind: Kind; every: string; unit: Unit; time: string; days: number[] };
}

function TaskForm({
  bridge,
  task,
  tasks,
  onDone,
}: {
  bridge: DesktopBridge;
  /** Task being edited; undefined when creating one. */
  task?: ScheduledTaskView;
  tasks: ScheduledTaskView[];
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation(["settings", "common"]);
  const { save } = useScheduledTaskCommands(bridge);
  const agents = useQuery(agentsQuery(bridge));
  const workspaces = useQuery(workspacesQuery(bridge));
  const initial = scheduleFields(task?.schedule);
  const [name, setName] = React.useState(task?.name ?? "");
  const [prompt, setPrompt] = React.useState(task?.prompt ?? "");
  const [agentId, setAgentId] = React.useState(task?.agentId ?? DEFAULT_AGENT_ID);
  const [workspaceId, setWorkspaceId] = React.useState(task?.workspaceId ?? DEFAULT_WORKSPACE_ID);
  const [kind, setKind] = React.useState<Kind>(initial.kind);
  const [every, setEvery] = React.useState(initial.every);
  const [unit, setUnit] = React.useState<Unit>(initial.unit);
  const [time, setTime] = React.useState(initial.time);
  const [days, setDays] = React.useState<number[]>(initial.days);
  const [enabled, setEnabled] = React.useState(task?.enabled ?? true);
  const [touched, setTouched] = React.useState(false);

  const trimmedName = name.trim();
  const trimmedPrompt = prompt.trim();
  const everyNumber = Number(every);
  const [minEvery, maxEvery] =
    unit === "minutes"
      ? [SCHEDULE_LIMITS.minMinutes, SCHEDULE_LIMITS.maxMinutes]
      : [1, SCHEDULE_LIMITS.maxHours];
  const errors = {
    name: !trimmedName
      ? t("scheduledTasks.editor.errors.nameRequired")
      : trimmedName.length > SCHEDULE_LIMITS.maxNameLength
        ? t("scheduledTasks.editor.errors.tooLong", { max: SCHEDULE_LIMITS.maxNameLength })
        : tasks.some(
              (other) =>
                other.id !== task?.id && other.name.toLowerCase() === trimmedName.toLowerCase(),
            )
          ? t("scheduledTasks.editor.errors.nameTaken")
          : null,
    prompt: !trimmedPrompt
      ? t("scheduledTasks.editor.errors.promptRequired")
      : trimmedPrompt.length > SCHEDULE_LIMITS.maxPromptLength
        ? t("scheduledTasks.editor.errors.tooLong", {
            max: SCHEDULE_LIMITS.maxPromptLength.toLocaleString(i18n.language),
          })
        : null,
    every:
      kind === "interval" &&
      (!Number.isInteger(everyNumber) || everyNumber < minEvery || everyNumber > maxEvery)
        ? t("scheduledTasks.editor.errors.interval", {
            minMinutes: SCHEDULE_LIMITS.minMinutes,
            maxMinutes: SCHEDULE_LIMITS.maxMinutes.toLocaleString(i18n.language),
            maxHours: SCHEDULE_LIMITS.maxHours,
          })
        : null,
    time: kind !== "interval" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time),
    days: kind === "weekly" && days.length === 0,
  };
  const valid = !errors.name && !errors.prompt && !errors.every && !errors.time && !errors.days;

  const agentItems = (agents.data ?? []).map((agent) => ({
    value: agent.id,
    label: `${agent.icon} ${agent.name}`,
  }));
  const workspaceItems = (workspaces.data ?? []).map((workspace) => ({
    value: workspace.id,
    label: `${workspace.icon} ${workspace.name}`,
  }));
  // A deleted agent or workspace is replaced by the default one when the task runs.
  const agentValue = agentItems.some((item) => item.value === agentId) ? agentId : DEFAULT_AGENT_ID;
  const workspaceValue = workspaceItems.some((item) => item.value === workspaceId)
    ? workspaceId
    : DEFAULT_WORKSPACE_ID;
  const kindItems = KINDS.map((value) => ({
    value,
    label: t(`scheduledTasks.editor.when.kinds.${value}`),
  }));
  const unitItems = UNITS.map((value) => ({
    value,
    label: t(`scheduledTasks.editor.when.units.${value}`),
  }));

  function schedule(): TaskSchedule {
    if (kind === "interval") return { kind, every: everyNumber, unit };
    if (kind === "daily") return { kind, time };
    return { kind, days, time };
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (!valid) return;
    save.mutate(
      {
        id: task?.id,
        name: trimmedName,
        prompt: trimmedPrompt,
        agentId: agentValue,
        workspaceId: workspaceValue,
        schedule: schedule(),
        enabled,
      },
      {
        onSuccess: (saved) => {
          toast.success(t("scheduledTasks.editor.saved", { name: saved.name }));
          onDone();
        },
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <FieldGroup>
        <Field data-invalid={touched && Boolean(errors.name)}>
          <FieldLabel htmlFor="task-name">{t("scheduledTasks.editor.name")}</FieldLabel>
          <Input
            id="task-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("scheduledTasks.editor.namePlaceholder")}
            maxLength={SCHEDULE_LIMITS.maxNameLength}
            autoComplete="off"
            aria-invalid={touched && Boolean(errors.name)}
          />
          {touched && errors.name && <FieldError>{errors.name}</FieldError>}
        </Field>
        <Field data-invalid={touched && Boolean(errors.prompt)}>
          <FieldLabel htmlFor="task-prompt">{t("scheduledTasks.editor.prompt")}</FieldLabel>
          <Textarea
            id="task-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t("scheduledTasks.editor.promptPlaceholder")}
            aria-invalid={touched && Boolean(errors.prompt)}
            className="min-h-40 resize-y"
          />
          {touched && errors.prompt ? (
            <FieldError>{errors.prompt}</FieldError>
          ) : (
            <FieldDescription>
              {t("scheduledTasks.editor.promptHelp", {
                max: SCHEDULE_LIMITS.maxPromptLength.toLocaleString(i18n.language),
              })}
            </FieldDescription>
          )}
        </Field>
        <OptionGroup legend={t("scheduledTasks.editor.agent")}>
          <Field>
            <Select
              items={agentItems}
              value={agentValue}
              onValueChange={(next) => next !== null && setAgentId(next)}
            >
              <SelectTrigger aria-label={t("scheduledTasks.editor.agent")} className="w-full">
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
        </OptionGroup>
        <OptionGroup legend={t("scheduledTasks.editor.workspace")}>
          <Field>
            <Select
              items={workspaceItems}
              value={workspaceValue}
              onValueChange={(next) => next !== null && setWorkspaceId(next)}
            >
              <SelectTrigger aria-label={t("scheduledTasks.editor.workspace")} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {workspaceItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>{t("scheduledTasks.editor.fallbackHelp")}</FieldDescription>
          </Field>
        </OptionGroup>
        <OptionGroup
          legend={t("scheduledTasks.editor.when.legend")}
          description={t("scheduledTasks.editor.when.description")}
        >
          <Field>
            <FieldLabel htmlFor="task-kind">{t("scheduledTasks.editor.when.kind")}</FieldLabel>
            <Select
              items={kindItems}
              value={kind}
              onValueChange={(next) => isKind(next) && setKind(next)}
            >
              <SelectTrigger id="task-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {kindItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {kind === "interval" && (
            <div className="flex items-start gap-3">
              <Field data-invalid={touched && Boolean(errors.every)} className="w-32 shrink-0">
                <FieldLabel htmlFor="task-every">
                  {t("scheduledTasks.editor.when.every")}
                </FieldLabel>
                <Input
                  id="task-every"
                  type="number"
                  inputMode="numeric"
                  min={minEvery}
                  max={maxEvery}
                  step={1}
                  value={every}
                  onChange={(event) => setEvery(event.target.value)}
                  aria-invalid={touched && Boolean(errors.every)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="task-unit">{t("scheduledTasks.editor.when.unit")}</FieldLabel>
                <Select
                  items={unitItems}
                  value={unit}
                  onValueChange={(next) => isUnit(next) && setUnit(next)}
                >
                  <SelectTrigger id="task-unit" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {unitItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          )}
          {touched && errors.every && <FieldError>{errors.every}</FieldError>}
          {kind === "weekly" && (
            <Field data-invalid={touched && errors.days}>
              <FieldLabel>{t("scheduledTasks.editor.when.days")}</FieldLabel>
              <ToggleGroup
                multiple
                variant="outline"
                spacing={1}
                className="flex-wrap"
                value={days.map(String)}
                onValueChange={(next) => setDays(next.map(Number))}
              >
                {WEEKDAY_ORDER.map((day) => (
                  <ToggleGroupItem
                    key={day}
                    value={String(day)}
                    aria-label={weekdayName(day, i18n.language, "long")}
                  >
                    {weekdayName(day, i18n.language)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {touched && errors.days && (
                <FieldError>{t("scheduledTasks.editor.errors.days")}</FieldError>
              )}
            </Field>
          )}
          {kind !== "interval" && (
            <Field data-invalid={touched && errors.time} className="w-40">
              <FieldLabel htmlFor="task-time">{t("scheduledTasks.editor.when.time")}</FieldLabel>
              <Input
                id="task-time"
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                aria-invalid={touched && errors.time}
              />
              {touched && errors.time && (
                <FieldError>{t("scheduledTasks.editor.errors.time")}</FieldError>
              )}
            </Field>
          )}
        </OptionGroup>
        <SwitchRow
          id="task-enabled"
          label={t("scheduledTasks.editor.enabled.label")}
          description={t("scheduledTasks.editor.enabled.description")}
          checked={enabled}
          onCheckedChange={setEnabled}
        />
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>{t("scheduledTasks.approval.title")}</AlertTitle>
          <AlertDescription>{t("scheduledTasks.approval.description")}</AlertDescription>
        </Alert>
      </FieldGroup>
      {save.isError && <FieldError>{save.error.message}</FieldError>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          type="submit"
          disabled={
            save.isPending || agents.isPending || workspaces.isPending || (touched && !valid)
          }
        >
          {save.isPending && <Spinner />}
          {task ? t("common:actions.save") : t("scheduledTasks.editor.create")}
        </Button>
      </div>
    </form>
  );
}

/** In-pane editor for a new scheduled task (`id` omitted) or an existing one. */
export function ScheduledTaskEditor({
  bridge,
  id,
  onDone,
}: {
  bridge: DesktopBridge;
  id?: string;
  onDone: () => void;
}) {
  const { t } = useTranslation("settings");
  const tasks = useQuery(scheduledTasksQuery(bridge));
  const task = tasks.data?.find((item) => item.id === id);
  useSettingsSubPage(
    id === undefined
      ? t("scheduledTasks.editor.newTitle")
      : (task?.name ?? t("scheduledTasks.editor.editTitle")),
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("scheduledTasks.editor.backToTasks")}
          onClick={onDone}
        >
          <ArrowLeftIcon />
        </Button>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-heading text-base font-medium">
            {id === undefined
              ? t("scheduledTasks.editor.newTitle")
              : task
                ? t("scheduledTasks.editor.editNamed", { name: task.name })
                : t("scheduledTasks.editor.editTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("scheduledTasks.editor.subtitle")}</p>
        </div>
      </header>
      {tasks.isPending ? (
        <Spinner />
      ) : tasks.isError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("scheduledTasks.editor.openError")}</AlertTitle>
          <AlertDescription>{tasks.error.message}</AlertDescription>
        </Alert>
      ) : id !== undefined && !task ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("scheduledTasks.editor.notFound.title")}</AlertTitle>
          <AlertDescription>{t("scheduledTasks.editor.notFound.description")}</AlertDescription>
        </Alert>
      ) : (
        <TaskForm
          key={task?.id ?? "new"}
          bridge={bridge}
          task={task}
          tasks={tasks.data}
          onDone={onDone}
        />
      )}
    </div>
  );
}
