import * as React from "react";
import type { RunSpanStatus } from "@workspace/shared";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group";
import { ChartGanttIcon, NetworkIcon, WorkflowIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatDuration, isLive, STATUS_COLOR, STATUS_DOT } from "@/components/run/run-model";
import { FlowView } from "@/components/run/flow-view";
import { SpanDetail } from "@/components/run/span-detail";
import { TimelineView } from "@/components/run/timeline-view";
import { spansOfRun, useRunStore } from "@/stores/run-store";

type View = "graph" | "timeline";
const VIEW_KEY = "pp-agent.run-view";
const STATUSES: RunSpanStatus[] = ["running", "waiting", "done", "error", "denied", "stopped"];

function savedView(): View {
  try {
    const value = localStorage.getItem(VIEW_KEY);
    if (value === "graph" || value === "timeline") return value;
  } catch {
    // Storage blocked: the default it is.
  }
  return "graph";
}

/** Ticks every second while something is running, so durations and the timeline move. */
function useNow(live: boolean): number {
  const [now, setNow] = React.useState(Date.now);
  React.useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [live]);
  return now;
}

/**
 * The Run tab: the conversation's runs, one at a time, as a workflow (each model step
 * and the tool calls it asked for, in order, helpers in parallel lanes) or a timeline (who worked
 * when). A click on a node or a bar shows what
 * went in and came out. Follows the newest run while it is going on.
 */
export function RunView({ session }: { session: string }) {
  const { t } = useTranslation("chat");
  const trace = useRunStore((state) => state.bySession[session]);
  const [view, setViewState] = React.useState<View>(savedView);
  const [picked, setPicked] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);

  const setView = (next: View) => {
    setViewState(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // A convenience only.
    }
  };

  const runs = trace?.runs ?? [];
  // A picked run that is gone (dropped as old) falls back to the newest.
  const runId = picked && runs.includes(picked) ? picked : runs.at(-1);
  const spans = React.useMemo(
    () => (trace && runId ? spansOfRun(trace, runId) : []),
    [trace, runId],
  );
  const run = runId ? trace?.spans[runId] : undefined;
  const live = run ? isLive(run) : false;
  const now = useNow(live);
  const selectedSpan = selected ? trace?.spans[selected] : undefined;

  if (!run || !trace) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <NetworkIcon />
          </EmptyMedia>
          <EmptyTitle>{t("run.tab")}</EmptyTitle>
          <EmptyDescription>{t("run.empty")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const agents = spans.filter((span) => span.kind === "agent").length;
  const tools = spans.filter((span) => span.kind === "tool").length;
  const steps = spans.filter((span) => span.kind === "step").length;
  const runItems = runs.toReversed().map((id, index) => ({
    value: id,
    label: trace.spans[id]?.name || t("run.untitled", { n: runs.length - index }),
  }));

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Select
          items={runItems}
          value={runId}
          onValueChange={(value) => {
            // The newest run is followed, not pinned: a new turn shows as it starts.
            setPicked(value === runs.at(-1) ? null : value);
            setSelected(null);
          }}
        >
          <SelectTrigger size="sm" className="max-w-72 min-w-40" aria-label={t("run.pickRun")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {runItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                <span
                  className={`size-2 shrink-0 rounded-full ${STATUS_DOT[trace.spans[item.value]?.status ?? "done"]}`}
                />
                <span className="truncate">{item.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {live && (
            <span
              className="size-2 animate-pulse rounded-full"
              style={{ background: STATUS_COLOR.running }}
            />
          )}
          {t("run.summary", {
            agents,
            steps,
            tools,
            duration: formatDuration((run.endedAt ?? now) - run.startedAt),
          })}
        </span>
        <div className="flex-1" />
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          value={[view]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "graph" || next === "timeline") setView(next);
          }}
        >
          <ToggleGroupItem value="graph" aria-label={t("run.views.graph")}>
            <WorkflowIcon />
            <span className="max-sm:hidden">{t("run.views.graph")}</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="timeline" aria-label={t("run.views.timeline")}>
            <ChartGanttIcon />
            <span className="max-sm:hidden">{t("run.views.timeline")}</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {view === "timeline" ? (
            <TimelineView spans={spans} now={now} selected={selected} onSelect={setSelected} />
          ) : (
            <FlowView spans={spans} now={now} selected={selected} onSelect={setSelected} />
          )}
          <div className="pointer-events-none absolute bottom-2 left-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {STATUSES.map((status) => (
              <span key={status} className="flex items-center gap-1">
                <span className={`size-2 rounded-full ${STATUS_DOT[status]}`} />
                {t(`run.status.${status}`)}
              </span>
            ))}
          </div>
        </div>
        {selectedSpan && (
          <aside className="w-80 shrink-0 border-l max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-10 max-md:w-full max-md:bg-background">
            <SpanDetail span={selectedSpan} now={now} onClose={() => setSelected(null)} />
          </aside>
        )}
      </div>
    </div>
  );
}
