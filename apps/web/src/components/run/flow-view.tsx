import * as React from "react";
import type { RunSpan } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { GitForkIcon, LocateFixedIcon, MaximizeIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  type FlowCard,
  type FlowEdge,
  type FlowGroup,
  type FlowLayout,
  layoutFlow,
} from "@/components/run/flow-layout";
import { formatDuration, isLive, spanDuration, STATUS_COLOR } from "@/components/run/run-model";
import { CardIcon } from "@/components/run/span-visual";

const PAD = 32;
const ZOOM = { min: 0.25, max: 1.75 } as const;
/** Smallest zoom the first fit goes to: below it the cards cannot be read. */
const FOLLOW_MIN_SCALE = 0.8;

interface View {
  x: number;
  y: number;
  scale: number;
}

/** What a card says under its title. */
function useCardText() {
  const { t } = useTranslation("chat");
  return (card: FlowCard, now: number): { title: string; detail: string } => {
    const { span } = card;
    switch (card.role) {
      case "start":
        return { title: t("run.flow.request"), detail: span.name };
      case "end":
        return {
          title: t(`run.status.${span.status}`),
          detail: formatDuration(spanDuration(span, now)),
        };
      case "agent":
        return { title: span.name, detail: span.target ?? span.model ?? "" };
      case "step": {
        const tokens = span.usage
          ? ` · ${t("run.flow.tokens", { count: span.usage.input + span.usage.output })}`
          : "";
        return {
          title: isLive(span) ? t("run.flow.thinking") : t("run.flow.step"),
          detail: span.target ?? (isLive(span) ? "…" : t("run.flow.toolsOnly")) + tokens,
        };
      }
      case "tool":
        return { title: span.name, detail: span.target ?? "" };
      case "more":
        return { title: t("run.flow.more", { count: card.hidden ?? 0 }), detail: "" };
    }
  };
}

function Edge({ edge }: { edge: FlowEdge }) {
  const { from, to } = edge;
  const bend = Math.max(24, (to.x - from.x) / 2);
  const path = `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
  return (
    <g>
      <path
        d={path}
        fill="none"
        className={edge.live ? "" : "stroke-border"}
        stroke={edge.live ? STATUS_COLOR.running : undefined}
        strokeWidth={edge.live ? 2 : 1.5}
        strokeDasharray={edge.live ? "6 6" : undefined}
        markerEnd={edge.live ? "url(#run-arrow-live)" : "url(#run-arrow)"}
      >
        {edge.live && (
          <animate
            attributeName="stroke-dashoffset"
            from="24"
            to="0"
            dur="0.8s"
            repeatCount="indefinite"
          />
        )}
      </path>
      {edge.live && (
        <circle r={3.5} fill={STATUS_COLOR.running}>
          <animateMotion dur="1.4s" repeatCount="indefinite" path={path} />
        </circle>
      )}
    </g>
  );
}

function Group({ group, now }: { group: FlowGroup; now: number }) {
  const { t } = useTranslation("chat");
  const { span } = group;
  return (
    <div
      className="absolute rounded-xl border border-dashed bg-muted/30"
      style={{
        left: group.x,
        top: group.y,
        width: group.width,
        height: group.height,
        borderColor: `${STATUS_COLOR[span.status]}88`,
      }}
    >
      <div className="flex h-7 items-center gap-1.5 px-3 text-xs text-muted-foreground">
        <GitForkIcon className="size-3.5" style={{ color: STATUS_COLOR[span.status] }} />
        <span className="font-mono font-medium text-foreground">{span.name}</span>
        <span>· {t("run.flow.parallel")}</span>
        <span className="ml-auto tabular-nums">{formatDuration(spanDuration(span, now))}</span>
      </div>
    </div>
  );
}

function Card({
  card,
  now,
  selected,
  onSelect,
  onExpand,
}: {
  card: FlowCard;
  now: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onExpand: (column: string) => void;
}) {
  const text = useCardText()(card, now);
  const { span, role } = card;
  const live = isLive(span) && role !== "start";
  const color = STATUS_COLOR[span.status];
  const muted = role === "start" || role === "end";
  return (
    <button
      type="button"
      data-live={live || undefined}
      onClick={() => (role === "more" && card.column ? onExpand(card.column) : onSelect(span.id))}
      className={cn(
        "absolute flex items-stretch overflow-hidden rounded-lg border bg-card text-left shadow-sm transition-shadow outline-none hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50",
        selected && "ring-2 ring-ring",
        role === "more" && "border-dashed bg-muted/50 shadow-none",
        role === "agent" && "bg-accent",
      )}
      style={{ left: card.x, top: card.y, width: card.width, height: card.height }}
      title={span.target ? `${span.name}\n${span.target}` : span.name}
    >
      <span className="w-1 shrink-0" style={{ background: muted ? "transparent" : color }} />
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-2.5">
        <span className="flex items-center gap-1.5">
          <CardIcon
            role={role}
            span={span}
            className={cn("size-3.5 shrink-0", live && "animate-pulse")}
            style={{ color: muted ? undefined : color }}
          />
          <span
            className={cn(
              "truncate text-xs font-medium",
              (role === "tool" || role === "more") && "font-mono",
            )}
          >
            {text.title}
          </span>
          {role !== "more" && role !== "start" && role !== "end" && (
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground tabular-nums">
              {formatDuration(spanDuration(span, now))}
            </span>
          )}
        </span>
        {text.detail && (
          <span className="line-clamp-2 text-[11px] leading-snug break-all text-muted-foreground">
            {text.detail}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * The run as a workflow: request → model step → the tool calls it asked for (stacked when they
 * ran together) → next step … → result. Helpers of `delegate_task` run in lanes inside its box.
 * Drag to pan, Ctrl/⌘ + wheel or the buttons to zoom; it follows the newest work while the run
 * goes on, until the person moves it.
 */
export function FlowView({
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
  const viewport = React.useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(() => new Set());
  const layout: FlowLayout = React.useMemo(() => layoutFlow(spans, expanded), [spans, expanded]);
  const [view, setView] = React.useState<View>({ x: PAD, y: PAD, scale: 1 });
  const [follow, setFollow] = React.useState(true);
  const drag = React.useRef<{ x: number; y: number; view: View } | null>(null);

  const runId = spans.find((span) => span.kind === "run")?.id;
  // A new run starts followed again, with its own columns folded.
  const [shownRun, setShownRun] = React.useState(runId);
  if (shownRun !== runId) {
    setShownRun(runId);
    setFollow(true);
    setExpanded(new Set());
  }

  const fit = React.useCallback(() => {
    const element = viewport.current;
    if (!element || layout.width === 0) return;
    const scale = Math.min(
      1,
      Math.max(
        ZOOM.min,
        Math.min(
          (element.clientWidth - 2 * PAD) / layout.width,
          (element.clientHeight - 2 * PAD) / layout.height,
        ),
      ),
    );
    setView({
      x: Math.max(PAD, (element.clientWidth - layout.width * scale) / 2),
      y: Math.max(PAD, (element.clientHeight - layout.height * scale) / 2),
      scale,
    });
  }, [layout.width, layout.height]);

  // Following: the whole run fits when it first shows (as small as `FOLLOW_MIN_SCALE`); after
  // that the view moves only when the newest live card (or the end) leaves it.
  const fitted = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    const element = viewport.current;
    if (!follow || !element || layout.width === 0) return;
    let start: View | null = null;
    if (fitted.current !== runId) {
      fitted.current = runId;
      const scale = Math.min(
        1,
        Math.max(
          FOLLOW_MIN_SCALE,
          Math.min(
            (element.clientWidth - 2 * PAD) / layout.width,
            (element.clientHeight - 2 * PAD) / layout.height,
          ),
        ),
      );
      start = { x: PAD, y: PAD, scale };
    }
    const live = layout.cards.filter((card) => isLive(card.span) && card.role !== "start");
    const target = live.length
      ? live.reduce((best, card) => (card.x > best.x ? card : best))
      : layout.cards.at(-1);
    if (!target) {
      if (start) setView(start);
      return;
    }
    setView((previous) => {
      const current = start ?? previous;
      const left = target.x * current.scale + current.x;
      const right = (target.x + target.width) * current.scale + current.x;
      const top = target.y * current.scale + current.y;
      const bottom = (target.y + target.height) * current.scale + current.y;
      let { x, y } = current;
      if (right > element.clientWidth - PAD) x -= right - (element.clientWidth - PAD);
      else if (left < PAD) x += PAD - left;
      if (bottom > element.clientHeight - PAD) y -= bottom - (element.clientHeight - PAD);
      else if (top < PAD) y += PAD - top;
      return x === previous.x && y === previous.y && current.scale === previous.scale
        ? previous
        : { ...current, x, y };
    });
  }, [follow, layout, runId]);

  const zoomBy = (factor: number, origin?: { x: number; y: number }) => {
    const element = viewport.current;
    if (!element) return;
    setFollow(false);
    setView((current) => {
      const scale = Math.min(ZOOM.max, Math.max(ZOOM.min, current.scale * factor));
      const at = origin ?? { x: element.clientWidth / 2, y: element.clientHeight / 2 };
      const ratio = scale / current.scale;
      return { scale, x: at.x - (at.x - current.x) * ratio, y: at.y - (at.y - current.y) * ratio };
    });
  };

  React.useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    // Not a React handler: it must be able to stop the page from scrolling or zooming.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setFollow(false);
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect();
        const factor = Math.exp(-event.deltaY / 300);
        setView((current) => {
          const scale = Math.min(ZOOM.max, Math.max(ZOOM.min, current.scale * factor));
          const at = { x: event.clientX - rect.left, y: event.clientY - rect.top };
          const ratio = scale / current.scale;
          return {
            scale,
            x: at.x - (at.x - current.x) * ratio,
            y: at.y - (at.y - current.y) * ratio,
          };
        });
      } else {
        setView((current) => ({
          ...current,
          x: current.x - (event.shiftKey ? event.deltaY : event.deltaX),
          y: current.y - (event.shiftKey ? 0 : event.deltaY),
        }));
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const groups = [...layout.groups].sort((a, b) => a.depth - b.depth);

  return (
    <div className="relative isolate size-full overflow-hidden">
      <div
        ref={viewport}
        className="relative size-full cursor-grab touch-none overflow-hidden select-none active:cursor-grabbing"
        style={{
          backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)",
          backgroundSize: `${20 * view.scale}px ${20 * view.scale}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, view };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          setFollow(false);
          setView({
            ...start.view,
            x: start.view.x + event.clientX - start.x,
            y: start.view.y + event.clientY - start.y,
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        >
          {groups.map((group) => (
            <Group key={group.id} group={group} now={now} />
          ))}
          <svg
            className="pointer-events-none absolute top-0 left-0 overflow-visible"
            width={layout.width}
            height={layout.height}
          >
            <defs>
              <marker
                id="run-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0,0 L10,5 L0,10 z" className="fill-border" />
              </marker>
              <marker
                id="run-arrow-live"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0,0 L10,5 L0,10 z" fill={STATUS_COLOR.running} />
              </marker>
            </defs>
            {layout.edges.map((edge) => (
              <Edge key={edge.id} edge={edge} />
            ))}
          </svg>
          {layout.cards.map((card) => (
            <Card
              key={card.id}
              card={card}
              now={now}
              selected={selected === card.span.id && card.role !== "end" && card.role !== "more"}
              onSelect={onSelect}
              onExpand={(column) => setExpanded((current) => new Set([...current, column]))}
            />
          ))}
        </div>
      </div>
      <div className="absolute top-2 right-2 flex gap-0.5 rounded-lg border bg-background/90 p-0.5 shadow-sm backdrop-blur">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("run.flow.zoomIn")}
          onClick={() => zoomBy(1.2)}
        >
          <ZoomInIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("run.flow.zoomOut")}
          onClick={() => zoomBy(1 / 1.2)}
        >
          <ZoomOutIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("run.flow.fit")}
          onClick={() => {
            setFollow(false);
            fit();
          }}
        >
          <MaximizeIcon />
        </Button>
        <Button
          variant={follow ? "secondary" : "ghost"}
          size="icon-sm"
          aria-label={t("run.follow")}
          aria-pressed={follow}
          onClick={() => setFollow(true)}
        >
          <LocateFixedIcon />
        </Button>
      </div>
    </div>
  );
}
