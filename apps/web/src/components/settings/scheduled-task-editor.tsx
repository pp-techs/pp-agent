import * as React from "react";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_WORKSPACE_ID,
  CRON_MAX_LENGTH,
  nextCronRun,
  parseCron,
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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Spinner } from "@workspace/ui/components/spinner";
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group";
import { Textarea } from "@workspace/ui/components/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ChevronDownIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { DateTimePicker } from "@/components/settings/datetime-picker";
import { TimeField } from "@/components/settings/time-field";
import { OptionGroup, SwitchRow } from "@/components/settings/option-group";
import {
  buildCron,
  describeCron,
  HOUR_STEPS,
  MINUTE_STEPS,
  type ScheduleBuilder,
} from "@/components/settings/schedule-builder";
import {
  formatWhen,
  WEEKDAY_ORDER,
  weekdayName,
} from "@/components/settings/scheduled-task-format";
import { localDateTime, onceTimestamp } from "@/components/settings/scheduled-task-fields";
import { useSettingsSubPage } from "@/components/settings/settings-subpage";
import {
  chatChoices,
  deliveryOf,
  deliveryValue,
} from "@/components/settings/scheduled-task-delivery";
import {
  scheduledTasksQuery,
  telegramAccountsQuery,
  useScheduledTaskCommands,
  zaloAccountsQuery,
} from "@/lib/extension-queries";
import { agentsQuery, workspacesQuery } from "@/lib/queries";

const KINDS = ["repeat", "once"] as const;
type Kind = (typeof KINDS)[number];

const isKind = (value: string | null): value is Kind => KINDS.some((kind) => kind === value);

/** How often a repeating task runs, as the plain form offers it. */
const FREQUENCIES = ["minutes", "hourly", "daily", "weekly", "monthly"] as const;
type Frequency = (typeof FREQUENCIES)[number];

const isFrequency = (value: string | null): value is Frequency =>
  FREQUENCIES.some((frequency) => frequency === value);

const DEFAULT_TIME = "09:00";
const DEFAULT_DAYS = [1, 2, 3, 4, 5];
const DEFAULT_BUILDER: ScheduleBuilder = { kind: "daily", time: DEFAULT_TIME };
const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => index + 1);
const UPCOMING_RUNS = 3;

/** The top of the next hour: a sensible starting point for a one-time task. */
function nextFullHour(): number {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return date.getTime();
}

/**
 * Starting values of the schedule fields for a task being edited (or a new one: every day at
 * 09:00). A repeating task the plain form cannot express opens in the advanced editor.
 */
function scheduleFields(schedule: TaskSchedule | undefined) {
  const expr = schedule?.kind === "cron" ? schedule.expr : buildCron(DEFAULT_BUILDER);
  const builder = describeCron(expr ?? "") ?? null;
  return {
    kind: schedule?.kind === "once" ? ("once" as const) : ("repeat" as const),
    at: localDateTime(schedule?.kind === "once" ? schedule.at : nextFullHour()),
    cron: expr ?? "",
    advanced: builder === null,
    builder: builder ?? DEFAULT_BUILDER,
  };
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
  const telegram = useQuery(telegramAccountsQuery(bridge));
  const zalo = useQuery(zaloAccountsQuery(bridge));
  const initial = scheduleFields(task?.schedule);
  const [name, setName] = React.useState(task?.name ?? "");
  const [prompt, setPrompt] = React.useState(task?.prompt ?? "");
  const [agentId, setAgentId] = React.useState(task?.agentId ?? DEFAULT_AGENT_ID);
  const [workspaceId, setWorkspaceId] = React.useState(task?.workspaceId ?? DEFAULT_WORKSPACE_ID);
  const [kind, setKind] = React.useState<Kind>(initial.kind);
  const [at, setAt] = React.useState(initial.at);
  const [cron, setCron] = React.useState(initial.cron);
  const [advanced, setAdvanced] = React.useState(initial.advanced);
  const [builder, setBuilder] = React.useState<ScheduleBuilder>(initial.builder);
  const [delivery, setDelivery] = React.useState(deliveryValue(task?.delivery));
  const [enabled, setEnabled] = React.useState(task?.enabled ?? true);
  const [touched, setTouched] = React.useState(false);
  const [openedAt] = React.useState(Date.now);

  const trimmedName = name.trim();
  const trimmedPrompt = prompt.trim();
  const atTimestamp = kind === "once" ? onceTimestamp(at, task?.schedule) : NaN;
  // What the schedule is written as: the advanced field as typed, else what the form's choices make.
  const expr = advanced ? cron : buildCron(builder);
  const cronResult = kind === "repeat" ? parseCron(expr, SCHEDULE_LIMITS.minMinutes) : null;
  const upcoming = React.useMemo(() => {
    if (!cronResult?.ok) return [];
    const runs: number[] = [];
    for (let after = openedAt; runs.length < UPCOMING_RUNS;) {
      const next = nextCronRun(cronResult.spec, after);
      if (next === null) break;
      runs.push(next);
      after = next;
    }
    return runs;
  }, [cronResult, openedAt]);
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
    at: kind === "once" && (!Number.isFinite(atTimestamp) || atTimestamp <= 0),
    cron:
      cronResult && !cronResult.ok
        ? advanced
          ? t(
              cronResult.problem === "never"
                ? "scheduledTasks.editor.errors.cronNever"
                : cronResult.problem === "tooFrequent"
                  ? "scheduledTasks.editor.errors.cronTooFrequent"
                  : "scheduledTasks.editor.errors.cron",
              { minMinutes: SCHEDULE_LIMITS.minMinutes },
            )
          : t("scheduledTasks.editor.errors.builder")
        : null,
  };
  const valid = !errors.name && !errors.prompt && !errors.at && !errors.cron;

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
  const chats = chatChoices(telegram.data, zalo.data, (kind) => t(`channels.${kind}.title`));
  const deliveryItems = [
    { value: "session", label: t("scheduledTasks.editor.delivery.session") },
    ...chats,
    { value: "none", label: t("scheduledTasks.editor.delivery.none") },
  ];
  // A chat that is switched off or unpaired now stays selectable, so saving does not change it.
  if (!deliveryItems.some((item) => item.value === delivery))
    deliveryItems.splice(deliveryItems.length - 1, 0, {
      value: delivery,
      label: t("scheduledTasks.editor.delivery.unavailable", { chat: delivery.slice(5) }),
    });
  const kindItems = KINDS.map((value) => ({
    value,
    label: t(`scheduledTasks.editor.when.kinds.${value}`),
  }));

  const frequencyItems = FREQUENCIES.map((value) => ({
    value,
    label: t(`scheduledTasks.editor.when.frequencies.${value}`),
  }));
  const minuteItems = MINUTE_STEPS.map((value) => ({
    value: String(value),
    label: t("scheduledTasks.editor.when.everyMinutes", { count: value }),
  }));
  const hourItems = HOUR_STEPS.map((value) => ({
    value: String(value),
    label: t("scheduledTasks.editor.when.everyHours", { count: value }),
  }));
  const minuteOfHourItems = [0, 15, 30, 45].map((value) => ({
    value: String(value),
    label: t("scheduledTasks.editor.when.pastTheHour", { minute: String(value).padStart(2, "0") }),
  }));
  const dayItems = MONTH_DAYS.map((value) => ({ value: String(value), label: String(value) }));

  /** The form's time, kept when the person changes how often the task runs. */
  const currentTime = "time" in builder ? builder.time : DEFAULT_TIME;

  function setFrequency(next: Frequency) {
    if (next === "minutes") setBuilder({ kind: "minutes", every: 15 });
    else if (next === "hourly") setBuilder({ kind: "hourly", every: 1, minute: 0 });
    else if (next === "daily") setBuilder({ kind: "daily", time: currentTime });
    else if (next === "weekly")
      setBuilder({
        kind: "weekly",
        days: builder.kind === "weekly" ? builder.days : DEFAULT_DAYS,
        time: currentTime,
      });
    else setBuilder({ kind: "monthly", day: 1, time: currentTime });
  }

  /** Opening the advanced editor starts from what the form wrote. */
  function openAdvanced() {
    if (!advanced) setCron(buildCron(builder) ?? cron);
    setAdvanced(true);
  }

  /** Back to the form when it can express what was typed; otherwise the person keeps editing. */
  function closeAdvanced() {
    const choice = describeCron(cron);
    if (choice) {
      setBuilder(choice);
      setAdvanced(false);
    }
  }

  function schedule(): TaskSchedule {
    if (kind === "once") return { kind, at: atTimestamp };
    return { kind: "cron", expr: cronResult?.ok ? cronResult.spec.expr : (expr ?? "").trim() };
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
        // These agent-created run options have no controls in this form.
        target: task?.target,
        delivery: delivery === "session" ? undefined : deliveryOf(delivery),
        origin: task?.origin,
        deleteAfterRun: task?.deleteAfterRun,
        silentIfEmpty: task?.silentIfEmpty,
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
          legend={t("scheduledTasks.editor.delivery.legend")}
          description={t("scheduledTasks.editor.delivery.description")}
        >
          <Field>
            <Select
              items={deliveryItems}
              value={delivery}
              onValueChange={(next) => next !== null && setDelivery(next)}
            >
              <SelectTrigger
                aria-label={t("scheduledTasks.editor.delivery.legend")}
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {deliveryItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {telegram.isSuccess && zalo.isSuccess && chats.length === 0 && (
              <FieldDescription>{t("scheduledTasks.editor.delivery.noChats")}</FieldDescription>
            )}
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
                <SelectGroup>
                  {kindItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {kind === "once" && (
            <Field data-invalid={touched && errors.at}>
              <FieldLabel htmlFor="task-at">{t("scheduledTasks.editor.when.at")}</FieldLabel>
              <DateTimePicker
                id="task-at"
                value={at}
                onChange={setAt}
                invalid={touched && errors.at}
              />
              {touched && errors.at ? (
                <FieldError>{t("scheduledTasks.editor.errors.at")}</FieldError>
              ) : (
                <FieldDescription>{t("scheduledTasks.editor.when.atHelp")}</FieldDescription>
              )}
            </Field>
          )}
          {kind === "repeat" && (
            <>
              {!advanced && (
                <>
                  <div className="flex flex-wrap items-start gap-3">
                    <Field className="w-auto min-w-44 flex-1">
                      <FieldLabel htmlFor="task-frequency">
                        {t("scheduledTasks.editor.when.frequency")}
                      </FieldLabel>
                      <Select
                        items={frequencyItems}
                        value={builder.kind}
                        onValueChange={(next) => isFrequency(next) && setFrequency(next)}
                      >
                        <SelectTrigger id="task-frequency" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {frequencyItems.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    {builder.kind === "minutes" && (
                      <Field className="w-40 shrink-0">
                        <FieldLabel htmlFor="task-every">
                          {t("scheduledTasks.editor.when.every")}
                        </FieldLabel>
                        <Select
                          items={minuteItems}
                          value={String(builder.every)}
                          onValueChange={(next) =>
                            next !== null && setBuilder({ kind: "minutes", every: Number(next) })
                          }
                        >
                          <SelectTrigger id="task-every" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {minuteItems.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    )}
                    {builder.kind === "hourly" && (
                      <>
                        <Field className="w-32 shrink-0">
                          <FieldLabel htmlFor="task-every">
                            {t("scheduledTasks.editor.when.every")}
                          </FieldLabel>
                          <Select
                            items={hourItems}
                            value={String(builder.every)}
                            onValueChange={(next) =>
                              next !== null && setBuilder({ ...builder, every: Number(next) })
                            }
                          >
                            <SelectTrigger id="task-every" className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {hourItems.map((item) => (
                                <SelectItem key={item.value} value={item.value}>
                                  {item.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field className="w-44 shrink-0">
                          <FieldLabel htmlFor="task-minute">
                            {t("scheduledTasks.editor.when.minute")}
                          </FieldLabel>
                          <Select
                            items={minuteOfHourItems}
                            value={String(builder.minute)}
                            onValueChange={(next) =>
                              next !== null && setBuilder({ ...builder, minute: Number(next) })
                            }
                          >
                            <SelectTrigger id="task-minute" className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {minuteOfHourItems.map((item) => (
                                <SelectItem key={item.value} value={item.value}>
                                  {item.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                      </>
                    )}
                    {builder.kind === "monthly" && (
                      <Field className="w-24 shrink-0">
                        <FieldLabel htmlFor="task-day">
                          {t("scheduledTasks.editor.when.dayOfMonth")}
                        </FieldLabel>
                        <Select
                          items={dayItems}
                          value={String(builder.day)}
                          onValueChange={(next) =>
                            next !== null && setBuilder({ ...builder, day: Number(next) })
                          }
                        >
                          <SelectTrigger id="task-day" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {dayItems.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    )}
                    {(builder.kind === "daily" ||
                      builder.kind === "weekly" ||
                      builder.kind === "monthly") && (
                      <Field className="w-auto shrink-0">
                        <FieldLabel htmlFor="task-time">
                          {t("scheduledTasks.editor.when.time")}
                        </FieldLabel>
                        <TimeField
                          id="task-time"
                          label={t("scheduledTasks.editor.when.time")}
                          value={builder.time}
                          onChange={(time) => setBuilder({ ...builder, time })}
                        />
                      </Field>
                    )}
                  </div>
                  {builder.kind === "weekly" && (
                    <Field data-invalid={touched && builder.days.length === 0}>
                      <FieldLabel>{t("scheduledTasks.editor.when.days")}</FieldLabel>
                      <ToggleGroup
                        multiple
                        variant="outline"
                        spacing={1}
                        className="flex-wrap"
                        value={builder.days.map(String)}
                        onValueChange={(next) => setBuilder({ ...builder, days: next.map(Number) })}
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
                      {touched && builder.days.length === 0 && (
                        <FieldError>{t("scheduledTasks.editor.errors.days")}</FieldError>
                      )}
                    </Field>
                  )}
                  {builder.kind === "monthly" && builder.day > 28 && (
                    <FieldDescription>
                      {t("scheduledTasks.editor.when.shortMonths")}
                    </FieldDescription>
                  )}
                </>
              )}
              <Collapsible
                open={advanced}
                onOpenChange={(open) => (open ? openAdvanced() : closeAdvanced())}
              >
                <CollapsibleTrigger
                  render={<Button type="button" variant="ghost" size="sm" className="-ml-2" />}
                >
                  <ChevronDownIcon
                    data-icon="inline-start"
                    className={advanced ? "rotate-180" : undefined}
                  />
                  {t("scheduledTasks.editor.when.advanced")}
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <Field data-invalid={touched && Boolean(errors.cron)}>
                    <FieldLabel htmlFor="task-cron">
                      {t("scheduledTasks.editor.when.cron")}
                    </FieldLabel>
                    <Input
                      id="task-cron"
                      value={cron}
                      onChange={(event) => setCron(event.target.value)}
                      maxLength={CRON_MAX_LENGTH}
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      placeholder="0 9 * * MON-FRI"
                      className="font-mono"
                      aria-invalid={touched && Boolean(errors.cron)}
                    />
                    {errors.cron && cron.trim() !== "" ? (
                      <FieldError>{errors.cron}</FieldError>
                    ) : (
                      <FieldDescription>
                        {t("scheduledTasks.editor.when.cronHelp")}
                      </FieldDescription>
                    )}
                  </Field>
                </CollapsibleContent>
              </Collapsible>
              {cronResult?.ok && (
                <FieldDescription>
                  {upcoming.length === 0
                    ? t("scheduledTasks.editor.when.cronNextNone")
                    : `${t("scheduledTasks.editor.when.cronNext")}: ${upcoming
                        .map((run) => formatWhen(run, i18n.language))
                        .join(" · ")}`}
                </FieldDescription>
              )}
            </>
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
