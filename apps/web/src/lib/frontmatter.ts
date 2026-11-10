/** One top-level key of a Markdown file's frontmatter, as the metadata block shows it. */
export interface FrontmatterField {
  key: string;
  value: string;
}

/** The opening `---` line, which only counts at the very start of the file. */
const OPENING = /^---[ \t]*\r?\n/;
/** A line that ends the block. */
const CLOSING = /^(?:---|\.\.\.)[ \t]*$/;
/** A top-level `key: value` pair; an indented line belongs to the key above it. */
const FIELD = /^([A-Za-z0-9_.-]+):[ \t]*(.*)$/;
/** A list item, which a key can hold several of. */
const ITEM = /^[ \t]+-[ \t]+(.*)$/;

function unquote(value: string): string {
  const quoted = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value);
  return quoted ? quoted[1] : value;
}

/**
 * The fields of a YAML frontmatter block, or an empty list when the lines are not one: the file
 * then has no metadata to show. A list becomes its items joined by commas, and any other indented
 * line continues the value above it, so nothing of a key is lost.
 */
function readFields(lines: readonly string[]): FrontmatterField[] {
  const fields: FrontmatterField[] = [];
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const field = FIELD.exec(line);
    if (field) {
      fields.push({ key: field[1], value: unquote(field[2].trim()) });
      continue;
    }
    const last = fields.at(-1);
    // Something other than a key before the first one: not a block this can render.
    if (!last) return [];
    const addition = unquote((ITEM.exec(line)?.[1] ?? line).trim());
    if (!addition) continue;
    last.value = last.value ? `${last.value}, ${addition}` : addition;
  }
  return fields;
}

/**
 * A Markdown file's YAML frontmatter, split off so it can be drawn as metadata: as the file is,
 * the opening and closing `---` draw a rule and the keys a heading. `body` is the file without the
 * block; a file with none (or with a block this cannot read) comes back whole.
 */
export function splitFrontmatter(text: string): { fields: FrontmatterField[]; body: string } {
  const opening = OPENING.exec(text);
  if (!opening) return { fields: [], body: text };
  const lines = text.slice(opening[0].length).split(/\r?\n/);
  const end = lines.findIndex((line) => CLOSING.test(line));
  if (end < 0) return { fields: [], body: text };
  const fields = readFields(lines.slice(0, end));
  if (fields.length === 0) return { fields: [], body: text };
  const body = lines
    .slice(end + 1)
    .join("\n")
    .replace(/^\n+/, "");
  return { fields, body };
}
