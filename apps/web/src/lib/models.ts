import type { ModelRef, ModelSummary } from "@workspace/shared";

/** Stable string id of a model, for list keys and select values. */
export const modelKey = (model: ModelRef) => `${model.provider}/${model.modelId}`;

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
