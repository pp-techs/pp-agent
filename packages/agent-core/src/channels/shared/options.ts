import type { ChatOption } from "../types.ts";

/** The name of an option without its icon, in lower case, for matching what the person typed. */
function plainName(label: string): string {
  return label
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .trim()
    .toLowerCase();
}

/** The option a person meant: its number in the list, its exact name, or a unique partial name. */
export function findOption(options: readonly ChatOption[], query: string): ChatOption | undefined {
  if (/^\d+$/.test(query)) return options[Number(query) - 1];
  const exact = options.filter((option) => plainName(option.label) === query);
  if (exact.length === 1) return exact[0];
  const partial = options.filter((option) => plainName(option.label).includes(query));
  return partial.length === 1 ? partial[0] : undefined;
}
