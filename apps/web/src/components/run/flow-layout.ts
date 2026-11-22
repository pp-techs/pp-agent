import type { RunSpan } from "@workspace/shared";

/**
 * The run as a workflow, laid out left to right: the request, then each model step followed by the
 * tool calls it asked for (stacked when they ran together), then the next step, and so on to the
 * end. A `delegate_task` call is a box holding one lane per helper, stacked, each with its own
 * steps and calls, so helpers that ran in parallel sit one above the other.
 */

export const CARD = { width: 216, height: 62 } as const;
const COL_GAP = 48;
const ROW_GAP = 14;
const GROUP_PAD = 12;
const GROUP_HEADER = 30;
const LANE_GAP = 12;
/** A column with more calls than this shows the first ones and a "+N more" card. */
export const COLUMN_LIMIT = 6;

export type CardRole = "start" | "end" | "agent" | "step" | "tool" | "more";

export interface FlowCard {
  /** Unique in the layout; the span's id, except for the end and "more" cards. */
  id: string;
  role: CardRole;
  span: RunSpan;
  /** "more" cards: how many calls they stand for, and the column they open. */
  hidden?: number;
  column?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** How many helper boxes it sits in. */
  depth: number;
}

export interface FlowGroup {
  id: string;
  span: RunSpan;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** The work it leads to is going on. */
  live: boolean;
}

export interface FlowLayout {
  cards: FlowCard[];
  groups: FlowGroup[];
  edges: FlowEdge[];
  width: number;
  height: number;
}

type Item =
  | { type: "card"; id: string; role: CardRole; span: RunSpan; hidden?: number; column?: string }
  | { type: "group"; span: RunSpan; lanes: Chain[] };

interface Chain {
  columns: Item[][];
}

interface Size {
  width: number;
  height: number;
}

function byStart(a: RunSpan, b: RunSpan): number {
  return a.startedAt - b.startedAt || a.id.localeCompare(b.id);
}

function isLiveSpan(span: RunSpan): boolean {
  return span.status === "running" || span.status === "waiting";
}

/** Builds the chains from the spans; `expanded` lists the columns shown whole. */
function buildChain(
  spans: RunSpan[],
  expanded: ReadonlySet<string>,
): { chain: Chain; run: RunSpan } | null {
  const children = new Map<string, RunSpan[]>();
  for (const span of spans) {
    if (!span.parentId) continue;
    const list = children.get(span.parentId) ?? [];
    list.push(span);
    children.set(span.parentId, list);
  }
  for (const list of children.values()) list.sort(byStart);
  const run = spans.find((span) => span.kind === "run");
  if (!run) return null;

  const toolItem = (tool: RunSpan): Item => {
    const helpers = (children.get(tool.id) ?? []).filter((span) => span.kind === "agent");
    if (helpers.length === 0) return { type: "card", id: tool.id, role: "tool", span: tool };
    return { type: "group", span: tool, lanes: helpers.map((helper) => agentChain(helper, true)) };
  };

  const toolColumn = (key: string, tools: RunSpan[]): Item[] => {
    const items = tools.map(toolItem);
    if (items.length <= COLUMN_LIMIT || expanded.has(key)) return items;
    // Keep the calls still going on in view, then the first ones.
    const shown = items
      .map((item, index) => ({ item, index, live: isLiveSpan(item.span) }))
      .sort((a, b) => Number(b.live) - Number(a.live) || a.index - b.index)
      .slice(0, COLUMN_LIMIT - 1)
      .sort((a, b) => a.index - b.index)
      .map(({ item }) => item);
    const hidden = tools[0];
    return hidden
      ? [
          ...shown,
          {
            type: "card",
            id: `${key}#more`,
            role: "more",
            span: hidden,
            hidden: items.length - shown.length,
            column: key,
          },
        ]
      : shown;
  };

  function agentChain(agent: RunSpan, withHead: boolean): Chain {
    const columns: Item[][] = withHead
      ? [[{ type: "card", id: agent.id, role: "agent", span: agent }]]
      : [];
    const own = children.get(agent.id) ?? [];
    // Calls made outside a step (none today) still show, in a column of their own.
    const loose = own.filter((span) => span.kind === "tool");
    if (loose.length > 0) columns.push(toolColumn(`${agent.id}#tools`, loose));
    for (const step of own.filter((span) => span.kind === "step")) {
      columns.push([{ type: "card", id: step.id, role: "step", span: step }]);
      const tools = (children.get(step.id) ?? []).filter((span) => span.kind === "tool");
      if (tools.length > 0) columns.push(toolColumn(step.id, tools));
    }
    return { columns };
  }

  const columns: Item[][] = [[{ type: "card", id: run.id, role: "start", span: run }]];
  for (const agent of (children.get(run.id) ?? []).filter((span) => span.kind === "agent")) {
    columns.push(...agentChain(agent, false).columns);
  }
  if (!isLiveSpan(run))
    columns.push([{ type: "card", id: `${run.id}#end`, role: "end", span: run }]);
  return { chain: { columns }, run };
}

const sizes = new WeakMap<object, Size>();

function itemSize(item: Item): Size {
  if (item.type === "card") return CARD;
  const cached = sizes.get(item);
  if (cached) return cached;
  const lanes = item.lanes.map(chainSize);
  const size = {
    width: Math.max(CARD.width, ...lanes.map((lane) => lane.width)) + 2 * GROUP_PAD,
    height:
      GROUP_HEADER +
      lanes.reduce((sum, lane) => sum + lane.height, 0) +
      LANE_GAP * Math.max(0, lanes.length - 1) +
      GROUP_PAD,
  };
  sizes.set(item, size);
  return size;
}

function columnSize(column: Item[]): Size {
  const items = column.map(itemSize);
  return {
    width: Math.max(0, ...items.map((size) => size.width)),
    height:
      items.reduce((sum, size) => sum + size.height, 0) + ROW_GAP * Math.max(0, items.length - 1),
  };
}

function chainSize(chain: Chain): Size {
  const cached = sizes.get(chain);
  if (cached) return cached;
  const columns = chain.columns.map(columnSize);
  const size = {
    width:
      columns.reduce((sum, size) => sum + size.width, 0) +
      COL_GAP * Math.max(0, columns.length - 1),
    height: Math.max(CARD.height, ...columns.map((size) => size.height)),
  };
  sizes.set(chain, size);
  return size;
}

/** Where an item is: its box, and its card or group id. */
interface Placed {
  id: string;
  span: RunSpan;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function layoutFlow(
  spans: RunSpan[],
  expanded: ReadonlySet<string> = new Set(),
): FlowLayout {
  const built = buildChain(spans, expanded);
  const layout: FlowLayout = { cards: [], groups: [], edges: [], width: 0, height: 0 };
  if (!built) return layout;

  const edge = (source: Placed, target: Placed) => {
    layout.edges.push({
      id: `${source.id}->${target.id}`,
      source: source.id,
      target: target.id,
      from: { x: source.x + source.width, y: source.y + source.height / 2 },
      to: { x: target.x, y: target.y + target.height / 2 },
      live: isLiveSpan(target.span),
    });
  };

  /**
   * Places a chain; returns where flow enters it (its first column) and leaves it (its last). A
   * group is entered at the head of each helper lane and left from each lane's last cards, so the
   * arrows fan out to the helpers and come back together after them.
   */
  const placeChain = (
    chain: Chain,
    x: number,
    y: number,
    depth: number,
  ): { entries: Placed[]; exits: Placed[] } => {
    let left = x;
    let previous: Placed[] = [];
    let entries: Placed[] = [];
    chain.columns.forEach((column, index) => {
      const size = columnSize(column);
      // Columns line up at the top, so a step and its calls read along one line.
      let top = y;
      const ins: Placed[] = [];
      const outs: Placed[] = [];
      for (const item of column) {
        const box = itemSize(item);
        if (item.type === "card") {
          const card: FlowCard = {
            id: item.id,
            role: item.role,
            span: item.span,
            ...(item.hidden ? { hidden: item.hidden } : {}),
            ...(item.column ? { column: item.column } : {}),
            x: left,
            y: top,
            width: box.width,
            height: box.height,
            depth,
          };
          layout.cards.push(card);
          ins.push(card);
          outs.push(card);
        } else {
          layout.groups.push({
            id: item.span.id,
            span: item.span,
            x: left,
            y: top,
            width: box.width,
            height: box.height,
            depth,
          });
          let laneTop = top + GROUP_HEADER;
          for (const lane of item.lanes) {
            const placed = placeChain(lane, left + GROUP_PAD, laneTop, depth + 1);
            ins.push(...placed.entries);
            outs.push(...placed.exits);
            laneTop += chainSize(lane).height + LANE_GAP;
          }
        }
        top += box.height + ROW_GAP;
      }
      // One to many fans out, many to one comes back together.
      for (const source of previous) for (const target of ins) edge(source, target);
      if (index === 0) entries = ins;
      previous = outs;
      left += size.width + COL_GAP;
    });
    return { entries, exits: previous };
  };

  placeChain(built.chain, 0, 0, 0);
  const size = chainSize(built.chain);
  layout.width = size.width;
  layout.height = size.height;
  return layout;
}
