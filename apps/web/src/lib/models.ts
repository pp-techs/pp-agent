import type { ModelRef, ModelSummary } from "@workspace/shared";

/** Stable string id of a model, for list keys and select values. */
export const modelKey = (model: ModelRef) => `${model.provider}/${model.modelId}`;

/** Words that read better in capitals than capitalized ("GPT 4o", not "Gpt 4o"). */
const ACRONYMS = new Set(["gpt", "glm", "llm"]);

/**
 * Short name of a model for buttons and lists. A custom provider often prefixes ids
 * (`anthropic-subscription/claude-sonnet-5-5`), so only the part after the last `/` is shown.
 * A name that is still a raw id (no spaces, as gateway models are until renamed) is also made
 * readable: dashes and underscores become spaces and a one-digit pair becomes a version
 * (`claude-sonnet-5-5` → `claude sonnet 5.5`). Names with spaces ("Claude Sonnet 4.5", from Pi's
 * catalog) are kept as they are. The full id stays available as the element's tooltip.
 */
export function modelLabel(model: Pick<ModelSummary, "name" | "modelId">): string {
  const full = model.name.trim() || model.modelId;
  const tail = full.slice(full.lastIndexOf("/") + 1) || full;
  // Real names ("Claude Sonnet 4.5", "GPT-4o") have spaces or capitals; raw ids are lowercase.
  if (/[\sA-Z]/.test(tail)) return tail;
  return tail
    .replace(/(?<!\d)(\d)[-_](\d)(?!\d)/g, "$1.$2")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) =>
      ACRONYMS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

type Labelable = Pick<ModelSummary, "provider" | "modelId" | "name">;

/**
 * `modelLabel` for every model of `models`, told apart when a provider lists the same label twice
 * (`a/claude-x` and `b/claude-x` are both "Claude X"): the id's prefix is added in brackets
 * ("Claude X (a)"), or the whole id when the prefixes are no better ("Claude X (claude-x-2)").
 * Providers do not clash with each other: lists show them under separate headings.
 */
export function modelLabeler(models: readonly Labelable[]): (model: Labelable) => string {
  const groups = new Map<string, Labelable[]>();
  for (const model of models) {
    const key = `${model.provider}\n${modelLabel(model)}`;
    groups.set(key, [...(groups.get(key) ?? []), model]);
  }
  const labels = new Map<string, string>();
  for (const group of groups.values()) {
    const base = modelLabel(group[0]!);
    if (group.length === 1) {
      labels.set(modelKey(group[0]!), base);
      continue;
    }
    const prefixes = group.map((model) =>
      model.modelId.includes("/") ? model.modelId.slice(0, model.modelId.lastIndexOf("/")) : "",
    );
    const usePrefix = prefixes.every(Boolean) && new Set(prefixes).size === group.length;
    group.forEach((model, index) =>
      labels.set(modelKey(model), `${base} (${usePrefix ? prefixes[index] : model.modelId})`),
    );
  }
  return (model) => labels.get(modelKey(model)) ?? modelLabel(model);
}

/** Groups models by provider, keeping the order of `list_models`. */
export function groupByProvider(models: ModelSummary[]) {
  const groups = new Map<string, { name: string; models: ModelSummary[] }>();
  for (const model of models) {
    const group = groups.get(model.provider) ?? { name: model.providerName, models: [] };
    group.models.push(model);
    groups.set(model.provider, group);
  }
  return [...groups.entries()];
}
