import * as React from "react";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_WORKSPACE_ID,
  SCHEDULE_LIMITS,
  type DesktopBridge,
  type ScheduledTaskView,
} from "@workspace/shared";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Spinner } from "@workspace/ui/components/spinner";
import { Switch } from "@workspace/ui/components/switch";
import { useQuery } from "@tanstack/react-query";
import {
  AlarmClockIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/modals/confirm-modal";
import { ScheduledTaskEditor } from "@/components/settings/scheduled-task-editor";
import { formatSchedule, formatWhen } from "@/components/settings/scheduled-task-format";
import { SectionHeading } from "@/components/settings/section-heading";
import { scheduledTasksQuery, useScheduledTaskCommands } from "@/lib/extension-queries";
import { agentsQuery, workspacesQuery } from "@/lib/queries";

type View = { kind: "list" } | { kind: "edit"; id?: string };

function TaskRow({
  bridge,
  task,
  agentName,
  workspaceName,
  onEdit,
}: {
  bridge: DesktopBridge;
  task: ScheduledTaskView;
  agentName: string;
  workspaceName: string;
  onEdit: () => void;
}) {
  const { t, i18n } = useTranslation(["settings", "common"]);
  const { remove, setEnabled, run } = useScheduledTaskCommands(bridge);
  const busy = remove.isPending || setEnabled.isPending || run.isPending;
  const active = task.state !== "idle";
  const { lastRun } = task;

  async function onDelete() {
    const confirmed = await ConfirmModal.show({
      title: t("scheduledTasks.deleteConfirm.title"),
      description: t("scheduledTasks.deleteConfirm.description", { name: task.name }),
      confirmLabel: t("common:actions.delete"),
    });
    if (!confirmed) return;
    remove.mutate(task.id, {
      onSuccess: () => toast.success(t("scheduledTasks.deleted", { name: task.name })),
    });
  }

  return (
    <Item variant="outline" size="sm">
      <ItemContent className="min-w-0">
        <ItemTitle className="flex-wrap">
          {task.name}
          {active && (
            <Badge variant="secondary">
              {task.state === "running" && <Spinner data-icon="inline-start" />}
              {t(`scheduledTasks.state.${task.state === "running" ? "running" : "queued"}`)}
            </Badge>
          )}
        </ItemTitle>
        <ItemDescription className="text-xs">
          {formatSchedule(task.schedule, t, i18n.language)}
          {" · "}
          {t("scheduledTasks.agentWorkspace", { agent: agentName, workspace: workspaceName })}
        </ItemDescription>
        <ItemDescription className="text-xs">
          {task.enabled && task.nextRun !== null
            ? t("scheduledTasks.nextRun", { when: formatWhen(task.nextRun, i18n.language) })
            : t("scheduledTasks.paused")}
        </ItemDescription>
        <ItemDescription className="text-xs">
          {lastRun === null
            ? t("scheduledTasks.lastRun.never")
            : t(`scheduledTasks.lastRun.${lastRun.status}`, {
                when: formatWhen(lastRun.at, i18n.language),
              })}
          {lastRun?.deniedTools ? (
            <>
              {" · "}
              {t("scheduledTasks.lastRun.denied", { count: lastRun.deniedTools })}
            </>
          ) : null}
        </ItemDescription>
        {lastRun?.status === "failed" && lastRun.error && (
          <ItemDescription className="text-xs text-destructive">{lastRun.error}</ItemDescription>
        )}
      </ItemContent>
      <ItemActions>
        {busy && <Spinner />}
        <Switch
          size="sm"
          checked={task.enabled}
          disabled={busy}
          aria-label={t("scheduledTasks.enableLabel", { name: task.name })}
          onCheckedChange={(enabled) => setEnabled.mutate({ id: task.id, enabled })}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={busy || active}
          onClick={() =>
            run.mutate(task.id, {
              onSuccess: () => toast.success(t("scheduledTasks.runQueued", { name: task.name })),
            })
          }
        >
          <PlayIcon data-icon="inline-start" />
          {t("scheduledTasks.runNow")}
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={t("scheduledTasks.editLabel")}
          onClick={onEdit}
        >
          <PencilIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("scheduledTasks.deleteLabel")}
          disabled={busy}
          onClick={() => void onDelete()}
        >
          <Trash2Icon />
        </Button>
      </ItemActions>
    </Item>
  );
}

export function ScheduledTasksSection({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation(["settings", "common"]);
  const tasks = useQuery(scheduledTasksQuery(bridge));
  const agents = useQuery(agentsQuery(bridge));
  const workspaces = useQuery(workspacesQuery(bridge));
  const [view, setView] = React.useState<View>({ kind: "list" });

  if (view.kind === "edit") {
    return (
      <ScheduledTaskEditor bridge={bridge} id={view.id} onDone={() => setView({ kind: "list" })} />
    );
  }

  const list = tasks.data ?? [];
  const full = list.length >= SCHEDULE_LIMITS.maxTasks;
  // A deleted agent or workspace is replaced by the default one when the task runs.
  const agentById = new Map((agents.data ?? []).map((agent) => [agent.id, agent]));
  const workspaceById = new Map(
    (workspaces.data ?? []).map((workspace) => [workspace.id, workspace]),
  );
  const agentName = (id: string) => {
    const agent = agentById.get(id) ?? agentById.get(DEFAULT_AGENT_ID);
    return agent ? `${agent.icon} ${agent.name}` : "…";
  };
  const workspaceName = (id: string) => {
    const workspace = workspaceById.get(id) ?? workspaceById.get(DEFAULT_WORKSPACE_ID);
    return workspace ? `${workspace.icon} ${workspace.name}` : "…";
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        title={t("scheduledTasks.title")}
        description={t("scheduledTasks.description")}
      >
        <Button disabled={!tasks.data || full} onClick={() => setView({ kind: "edit" })}>
          <PlusIcon />
          {t("scheduledTasks.add")}
        </Button>
      </SectionHeading>

      <Alert>
        <TriangleAlertIcon />
        <AlertTitle>{t("scheduledTasks.approval.title")}</AlertTitle>
        <AlertDescription>{t("scheduledTasks.approval.description")}</AlertDescription>
      </Alert>

      {tasks.isPending ? (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : tasks.isError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("scheduledTasks.loadError")}</AlertTitle>
          <AlertDescription>{tasks.error.message}</AlertDescription>
        </Alert>
      ) : list.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AlarmClockIcon />
            </EmptyMedia>
            <EmptyTitle>{t("scheduledTasks.empty.title")}</EmptyTitle>
            <EmptyDescription>{t("scheduledTasks.empty.description")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <ItemGroup>
            {list.map((task) => (
              <TaskRow
                key={task.id}
                bridge={bridge}
                task={task}
                agentName={agentName(task.agentId)}
                workspaceName={workspaceName(task.workspaceId)}
                onEdit={() => setView({ kind: "edit", id: task.id })}
              />
            ))}
          </ItemGroup>
          <p className="text-xs text-muted-foreground">
            {t("scheduledTasks.count", { count: list.length, max: SCHEDULE_LIMITS.maxTasks })}
          </p>
        </>
      )}
    </div>
  );
}
