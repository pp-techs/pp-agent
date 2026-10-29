const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;

export interface Fence {
  marker: string;
  lang: string;
}

/** Backtick info strings cannot contain backticks (including after the language word). */
export function openingFence(line: string): Fence | null {
  const match = FENCE.exec(line);
  if (!match || (match[1]![0] === "`" && match[2]!.includes("`"))) return null;
  return { marker: match[1]!, lang: match[2]!.trim().split(/[\s`]/)[0]! };
}

/** Text of an opening fence line, such as "```ts". */
function fenceLine(fence: Fence): string {
  return fence.marker + fence.lang;
}

export function advanceFence(line: string, open: Fence | null): Fence | null {
  if (open) {
    const close = FENCE_CLOSE.exec(line);
    return close && close[1]![0] === open.marker[0] && close[1]!.length >= open.marker.length
      ? null
      : open;
  }
  const start = openingFence(line);
  return start ? { ...start, lang: start.lang.slice(0, 20) } : null;
}

interface Candidate {
  /** Where the chunk ends (exclusive). */
  cut: number;
  /** Higher is a nicer place to cut. */
  rank: number;
  fence: Fence | null;
}

/** Picks where to end the next chunk inside `window` (the text that fits). */
function chooseCut(window: string, start: Fence | null, source: string): Candidate {
  const fullLine = (offset: number) => {
    const end = source.indexOf("\n", offset);
    return source.slice(offset, end < 0 ? source.length : end);
  };
  const candidates: Candidate[] = [];
  let fence = start;
  let offset = 0;
  while (offset < window.length) {
    const newline = window.indexOf("\n", offset);
    const lineEnd = newline === -1 ? window.length : newline;
    const line = window.slice(offset, lineEnd);
    const before = fence;
    fence = advanceFence(fullLine(offset), fence);
    if (newline !== -1) {
      const paragraph = line.trim() === "" && !fence;
      // A cut after the line `offset..newline`; the fence state is the one after that line.
      candidates.push({
        cut: newline + 1,
        rank: fence ? 2 : paragraph ? 5 : 4,
        fence,
      });
    }
    // A space inside a line is a weaker choice, used for very long lines.
    const space = line.lastIndexOf(" ");
    if (space > 0)
      candidates.push({ cut: offset + space + 1, rank: before ? 1 : 3, fence: before });
    offset = lineEnd + 1;
  }
  const minimum = Math.floor(window.length / 4);
  let best: Candidate | null = null;
  for (const candidate of candidates) {
    if (candidate.cut < minimum) continue;
    if (
      !best ||
      candidate.rank > best.rank ||
      (candidate.rank === best.rank && candidate.cut > best.cut)
    )
      best = candidate;
  }
  if (best) return best;
  // No natural boundary: cut at the limit, not between the halves of a surrogate pair.
  let cut = window.length;
  const last = window.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff && cut > 1) cut--;
  let fenceAtCut = start;
  let lineOffset = 0;
  for (const line of window.slice(0, cut).split("\n")) {
    fenceAtCut = advanceFence(fullLine(lineOffset), fenceAtCut);
    lineOffset += line.length + 1;
  }
  return { cut, rank: 0, fence: fenceAtCut };
}

/**
 * Splits `text` into chunks of at most `limit` UTF-16 units. Cuts fall on paragraph, line or word
 * boundaries; a fenced code block is kept whole when it fits, and otherwise closed at the end of
 * a chunk and re-opened at the start of the next.
 */
export function splitText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  let fence: Fence | null = null;
  while (rest.length > 0) {
    const prefix = fence ? `${fenceLine(fence)}\n` : "";
    if (prefix.length + rest.length <= limit) {
      chunks.push(prefix + rest);
      break;
    }
    // Room for a closing fence ("\n" + marker) in case this chunk ends inside a code block.
    const budget = limit - prefix.length - 1 - (fence?.marker.length ?? 3) - 8;
    const window = rest.slice(0, Math.max(budget, 1));
    const chosen = chooseCut(window, fence, rest);
    let body = rest.slice(0, chosen.cut);
    if (chosen.fence) {
      body = `${body.endsWith("\n") ? body : `${body}\n`}${chosen.fence.marker}`;
    } else {
      body = body.trimEnd();
    }
    chunks.push(prefix + body);
    rest = rest.slice(chosen.cut);
    rest = chosen.fence ? rest.replace(/^\n+/, "") : rest.replace(/^\s+/, "");
    fence = chosen.fence;
  }
  return chunks.filter((chunk) => chunk.trim() !== "");
}
