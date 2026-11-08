import { RESEARCH_DEPTHS, type ResearchDepth } from "@workspace/shared";

export const DEFAULT_RESEARCH_DEPTH: ResearchDepth = "standard";

/**
 * The argument of `/research`: an optional depth word, then the question. `question` is empty when
 * the person gave none (the caller explains the usage).
 */
export function parseResearchArgument(argument: string): {
  depth: ResearchDepth;
  question: string;
} {
  const text = argument.trim();
  const first = /^\S+/.exec(text)?.[0].toLowerCase();
  const depth = RESEARCH_DEPTHS.find((candidate) => candidate === first);
  return depth
    ? { depth, question: text.slice(first!.length).trim() }
    : { depth: DEFAULT_RESEARCH_DEPTH, question: text };
}
