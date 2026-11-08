import type { AgentCommandMap } from "@workspace/shared";
import { type ResearchDepth, type ResearchSummary, RESEARCH_DEPTHS } from "@workspace/shared";

/** The command that starts a run. */
export type ResearchStart = Extract<AgentCommandMap["set_research"]["params"], { action: "start" }>;

/** What `/research [depth] <question>` means: the question, and a depth when one was typed. */
export interface ResearchCommand {
  depth: ResearchDepth | null;
  question: string;
}

/** The depth remembered from the last run, so a new one starts where the person left off. */
const LAST_DEPTH_KEY = "pp-agent:research-depth";

/** A depth name from storage, or null when it is not one of the three. */
export function parseResearchDepth(value: string | null): ResearchDepth | null {
  return value && (RESEARCH_DEPTHS as readonly string[]).includes(value)
    ? (value as ResearchDepth)
    : null;
}

export function lastResearchDepth(): ResearchDepth {
  const saved = typeof localStorage === "undefined" ? null : localStorage.getItem(LAST_DEPTH_KEY);
  return parseResearchDepth(saved) ?? "standard";
}

export function rememberResearchDepth(depth: ResearchDepth): void {
  try {
    localStorage.setItem(LAST_DEPTH_KEY, depth);
  } catch {}
}

/**
 * `/research <question>` starts a run. A depth word (`quick`, `standard`, `deep`) may lead the
 * question; a word that only looks like one ("deepseek") stays part of the question. Null when the
 * draft is not a `/research` command (a bare one included).
 */
export function parseResearchCommand(draft: string): ResearchCommand | null {
  const match = /^\/research\s+([\s\S]*)$/i.exec(draft.trim());
  if (!match) return null;
  const rest = match[1] ?? "";
  if (!rest.trim()) return null;
  const first = /^(\S+?)(?:\s+([\s\S]*))?$/.exec(rest.trim());
  const depth = parseResearchDepth(first?.[1]?.toLowerCase() ?? null);
  if (depth) return { depth, question: (first?.[2] ?? "").trim() };
  return { depth: null, question: rest.trim() };
}

/**
 * Key in the `chat` namespace of where a run stands: paused and done first, then the plan waiting
 * for the person, then the phase itself.
 */
export function researchPhaseKey(
  run: ResearchSummary,
):
  | "research.phase.paused"
  | "research.phase.done"
  | "research.phase.plan"
  | "research.phase.waiting"
  | "research.phase.planning"
  | "research.phase.researching"
  | "research.phase.writing" {
  if (run.status === "paused") return "research.phase.paused";
  if (run.status === "done") return "research.phase.done";
  if (run.phase === "plan") return "research.phase.plan";
  if (run.waiting) return "research.phase.waiting";
  if (run.phase === "planning") return "research.phase.planning";
  if (run.phase === "writing") return "research.phase.writing";
  return "research.phase.researching";
}

/** Key in the `chat` namespace of the depth's label. */
export function researchDepthKey(
  depth: ResearchSummary["depth"],
): "research.depth.quick" | "research.depth.standard" | "research.depth.deep" {
  if (depth === "quick") return "research.depth.quick";
  if (depth === "deep") return "research.depth.deep";
  return "research.depth.standard";
}

/** Whether a source address is one a click may open (never `javascript:`, `file:` and the like). */
export function isWebUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** The site of a source address, without `www.`; the address itself when it does not parse. */
export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The file name at the end of a report's path. */
export function reportFileName(path: string): string {
  return path.split("/").pop() ?? path;
}
