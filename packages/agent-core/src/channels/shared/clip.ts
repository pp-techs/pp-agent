/**
 * `text` within `limit` characters: its start and its end around a line saying how many characters
 * are left out (`hidden`). The end is kept because that is where a long command hides what it does.
 */
export function clipMiddle(text: string, limit: number, hidden: (count: number) => string): string {
  if (text.length <= limit) return text;
  const keep = Math.max(0, limit - hidden(text.length).length - 2);
  const head = Math.floor(keep / 2);
  const tail = keep - head;
  return `${text.slice(0, head)}\n${hidden(text.length - keep)}\n${text.slice(text.length - tail)}`;
}
