import * as React from "react";
import type { RunSpan } from "@workspace/shared";
import { cn } from "@workspace/ui/lib/utils";
import { BotIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatDuration, isLive, lanesOf, STATUS_COLOR } from "@/components/run/run-model";

const LABEL_WIDTH = 168;
const AGENT_ROW = 28;
const TOOL_ROW = 22;
const MIN_BAR = 3;

/** Steps of the time axis, in ms; the first that gives ticks at least ~90px apart is used. */
const STEPS = [100, 250, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000];

/**
 * The run as lanes over time: one per agent (helpers under the call that started them), with
 * each tool call as a bar. Calls that ran at the same time show side by side; bars of an agent
 * that overlap stack in rows.
 */
export function TimelineView({
  spans,
  now,
  selected,
  onSelect,
}: {
  spans: RunSpan[];
  now: number;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation("chat");
  const scroller = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(600);
  React.useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const run = spans.find((span) => span.kind === "run");
  const lanes = React.useMemo(() => lanesOf(spans), [spans]);
  if (!run) return null;

  const start = run.startedAt;
  const end = Math.max(run.endedAt ?? now, start + 1000);
  const plot = Math.max(width - LABEL_WIDTH - 16, 120);
  const scale = plot / (end - start);
  const x = (at: number) => LABEL_WIDTH + (at - start) * scale;
  const step = STEPS.find((candidate) => candidate * scale >= 90) ?? STEPS.at(-1) ?? 60_000;
  const ticks: number[] = [];
  for (let at = 0; at <= end - start; at += step) ticks.push(at);

  // Each lane: the agent's bar on its own row, then its tool calls packed into rows.
  const rows = lanes.map((lane) => {
    const packed: number[] = [];
    const placed = lane.tools.map((tool) => {
      const toolEnd = tool.endedAt ?? now;
      let row = packed.findIndex((freeAt) => freeAt <= tool.startedAt);
      if (row === -1) row = packed.push(0) - 1;
      packed[row] = toolEnd;
      return { tool, row };
    });
    return { lane, placed, height: AGENT_ROW + Math.max(packed.length, 1) * TOOL_ROW + 6 };
  });
  const tops = rows.map((_, index) =>
    rows.slice(0, index).reduce((sum, row) => sum + row.height, 24),
  );
  const height = 24 + rows.reduce((sum, row) => sum + row.height, 0);

  return (
    <div ref={scroller} className="size-full overflow-auto">
      <svg width={width} height={height} className="block text-[11px]" role="img">
        {ticks.map((at) => (
          <g key={at}>
            <line
              x1={x(start + at)}
              x2={x(start + at)}
              y1={18}
              y2={height}
              className="stroke-border"
              strokeDasharray="2 3"
            />
            <text x={x(start + at) + 3} y={12} className="fill-muted-foreground">
              {formatDuration(at)}
            </text>
          </g>
        ))}
        {!run.endedAt && (
          <line x1={x(now)} x2={x(now)} y1={18} y2={height} stroke={STATUS_COLOR.running} />
        )}
        {rows.map(({ lane, placed, height: laneHeight }, index) => {
          const laneTop = tops[index] ?? 24;
          const { agent } = lane;
          const agentEnd = agent.endedAt ?? now;
          return (
            <g key={agent.id}>
              <rect
                x={0}
                y={laneTop}
                width={width}
                height={laneHeight}
                className={cn(lane.depth % 2 === 1 ? "fill-muted/40" : "fill-transparent")}
              />
              <foreignObject x={4} y={laneTop + 4} width={LABEL_WIDTH - 12} height={20}>
                <button
                  type="button"
                  onClick={() => onSelect(agent.id)}
                  className={cn(
                    "flex w-full items-center gap-1 truncate rounded px-1 text-left text-xs hover:bg-muted",
                    selected === agent.id && "bg-muted font-medium",
                  )}
                  style={{ paddingLeft: 4 + lane.depth * 12 }}
                  title={agent.name}
                >
                  <BotIcon className="size-3 shrink-0" />
                  <span className="truncate">{agent.name}</span>
                </button>
              </foreignObject>
              <Bar
                span={agent}
                x={x(agent.startedAt)}
                y={laneTop + 8}
                width={Math.max((agentEnd - agent.startedAt) * scale, MIN_BAR)}
                height={12}
                selected={selected === agent.id}
                onSelect={onSelect}
                faint
              />
              {/* Model steps on the agent's row: when it was thinking, between its calls. */}
              {lane.steps.map((step) => (
                <Bar
                  key={step.id}
                  span={step}
                  x={x(step.startedAt)}
                  y={laneTop + 6}
                  width={Math.max(((step.endedAt ?? now) - step.startedAt) * scale, MIN_BAR)}
                  height={16}
                  selected={selected === step.id}
                  onSelect={onSelect}
                  label={step.target ?? step.error ?? t("run.flow.step")}
                />
              ))}
              {placed.map(({ tool, row }) => (
                <Bar
                  key={tool.id}
                  span={tool}
                  x={x(tool.startedAt)}
                  y={laneTop + AGENT_ROW + row * TOOL_ROW}
                  width={Math.max(((tool.endedAt ?? now) - tool.startedAt) * scale, MIN_BAR)}
                  height={TOOL_ROW - 6}
                  selected={selected === tool.id}
                  onSelect={onSelect}
                  label={tool.target ? `${tool.name} ${tool.target}` : tool.name}
                />
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Bar({
  span,
  x,
  y,
  width,
  height,
  selected,
  onSelect,
  label,
  faint,
}: {
  span: RunSpan;
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
  onSelect: (id: string) => void;
  label?: string;
  faint?: boolean;
}) {
  const color = STATUS_COLOR[span.status];
  return (
    <g
      role="button"
      tabIndex={0}
      className="cursor-pointer outline-none"
      onClick={() => onSelect(span.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect(span.id);
      }}
    >
      <title>{label ?? span.name}</title>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={3}
        fill={color}
        fillOpacity={faint ? 0.25 : 0.85}
        stroke={selected ? "currentColor" : color}
        strokeWidth={selected ? 2 : 1}
        className={cn(isLive(span) && "animate-pulse")}
      />
      {label && width > 40 && (
        <text
          x={x + 4}
          y={y + height / 2 + 4}
          className="pointer-events-none fill-white font-mono text-[10px]"
        >
          {label.length * 6 > width - 8
            ? `${label.slice(0, Math.max(1, Math.floor((width - 8) / 6) - 1))}…`
            : label}
        </text>
      )}
    </g>
  );
}
