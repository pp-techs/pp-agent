import {
  advanceFence,
  type Fence,
  openingFence,
  splitText as splitMessage,
} from "../shared/split.ts";
import { isParseError, type SendOptions, type TelegramApi } from "./api.ts";

/** Telegram refuses messages longer than 4096 UTF-16 code units. */
export const MESSAGE_LIMIT = 4096;

/** One message to send: `html` for `parse_mode: HTML`, `plain` as the fallback. */
export interface FormattedChunk {
  html: string;
  plain: string;
}

// ---------------------------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------------------------

/** Splits `text` to Telegram's message length, keeping code blocks intact (see `splitMessage`). */
export function splitText(text: string, limit = MESSAGE_LIMIT): string[] {
  return splitMessage(text, limit);
}

// ---------------------------------------------------------------------------------------------
// Markdown to Telegram HTML
// ---------------------------------------------------------------------------------------------

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const OPEN = "\uE000";
const CLOSE = "\uE001";
const SAFE_URL = /^(https?:\/\/|mailto:|tg:\/\/)/i;

/** Tags Telegram accepts that this converter emits; a stray or crossed one makes Telegram reject. */
function balanced(html: string): boolean {
  const stack: string[] = [];
  for (const match of html.matchAll(/<(\/?)([a-z]+)[^>]*>/g)) {
    if (match[1]) {
      if (stack.pop() !== match[2]) return false;
    } else stack.push(match[2]!);
  }
  return stack.length === 0;
}

/** Inline Markdown of one line to Telegram HTML. */
function inline(line: string): string {
  const stash: string[] = [];
  const keep = (html: string): string => {
    stash.push(html);
    return `${OPEN}${stash.length - 1}${CLOSE}`;
  };
  // Source text never contains the private-use markers used for stashing.
  let text = line.replaceAll(OPEN, "").replaceAll(CLOSE, "");
  text = text.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, _ticks, code: string) =>
    keep(`<code>${escapeHtml(code)}</code>`),
  );
  text = escapeHtml(text);
  text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, label: string, url: string) => {
    const href = url.replace(/&amp;/g, "&");
    if (!SAFE_URL.test(href)) return whole;
    const open = keep(`<a href="${href.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">`);
    return `${open}${label}${keep("</a>")}`;
  });
  text = text
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "<b>$1</b>")
    .replace(/(?<![\w_])__(?=\S)(.+?)(?<=\S)__(?![\w_])/g, "<b>$1</b>")
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, "<s>$1</s>")
    .replace(/(?<![*\w])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![*\w])/g, "<i>$1</i>")
    .replace(/(?<![\w_])_(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?![\w_])/g, "<i>$1</i>");
  let html = text;
  // Stashed pieces may sit inside each other (a link around code), so unfold until none remain.
  for (let round = 0; round < 4 && html.includes(OPEN); round++)
    html = html.replace(
      new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g"),
      (_, index: string) => stash[Number(index)] ?? "",
    );
  return balanced(html) ? html : escapeHtml(line.replaceAll(OPEN, "").replaceAll(CLOSE, ""));
}

function codeBlock(lines: string[], lang: string): string {
  const body = escapeHtml(lines.join("\n"));
  return /^[\w+#.-]{1,30}$/.test(lang)
    ? `<pre><code class="language-${lang}">${body}</code></pre>`
    : `<pre>${body}</pre>`;
}

/**
 * Converts the assistant's Markdown to the HTML subset Telegram understands: bold, italic,
 * strikethrough, inline code, code blocks, links and quotes. Headings become bold lines, lists
 * become plain bullets and tables stay as monospace text.
 */
export function markdownToTelegramHtml(markdown: string): string {
  const out: string[] = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = openingFence(line);
    if (fence) {
      const body: string[] = [];
      let open: Fence | null = fence;
      for (i++; i < lines.length; i++) {
        open = advanceFence(lines[i]!, open);
        if (!open) break;
        body.push(lines[i]!);
      }
      out.push(codeBlock(body, fence.lang));
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|.*\|\s*$/.test(lines[i + 1] ?? "")) {
      const rows: string[] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) rows.push(lines[i++]!.trim());
      i--;
      out.push(codeBlock(rows, ""));
      continue;
    }
    if (/^ {0,3}>/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^ {0,3}>/.test(lines[i]!))
        quoted.push(inline(lines[i++]!.replace(/^ {0,3}>\s?/, "")));
      i--;
      out.push(`<blockquote>${quoted.join("\n")}</blockquote>`);
      continue;
    }
    const heading = /^ {0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
    if (heading) {
      out.push(`<b>${inline(heading[1]!).replace(/<\/?b>/g, "")}</b>`);
      continue;
    }
    if (/^ {0,3}([-*_])( ?\1){2,}\s*$/.test(line)) {
      out.push("──────");
      continue;
    }
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      out.push(`${bullet[1]}• ${inline(bullet[2]!)}`);
      continue;
    }
    out.push(inline(line));
  }
  return out.join("\n");
}

/**
 * Splits Markdown into messages and renders each. A chunk whose HTML would exceed the limit
 * (escaping and tags add length) is split again from a smaller budget.
 */
export function formatMessage(markdown: string): FormattedChunk[] {
  let limit = MESSAGE_LIMIT;
  for (;;) {
    const chunks = splitText(markdown, limit).map((plain) => ({
      plain,
      html: markdownToTelegramHtml(plain),
    }));
    if (chunks.every((chunk) => chunk.html.length <= MESSAGE_LIMIT) || limit <= 256) return chunks;
    limit = Math.floor(limit * 0.75);
  }
}

// ---------------------------------------------------------------------------------------------
// Sending with a plain-text fallback
// ---------------------------------------------------------------------------------------------

/** Sends a chunk as HTML; when Telegram cannot parse it, sends the plain text instead. */
export async function sendFormatted(
  api: TelegramApi,
  chatId: number,
  chunk: FormattedChunk,
  options: Omit<SendOptions, "parseMode"> = {},
): Promise<{ message_id: number }> {
  try {
    return await api.sendMessage(chatId, chunk.html, { ...options, parseMode: "HTML" });
  } catch (error) {
    if (!isParseError(error)) throw error;
    return api.sendMessage(chatId, chunk.plain, options);
  }
}

/** Edits a message to a chunk as HTML, falling back to plain text like `sendFormatted`. */
export async function editFormatted(
  api: TelegramApi,
  chatId: number,
  messageId: number,
  chunk: FormattedChunk,
  options: Omit<SendOptions, "parseMode"> = {},
): Promise<void> {
  try {
    await api.editMessageText(chatId, messageId, chunk.html, { ...options, parseMode: "HTML" });
  } catch (error) {
    if (!isParseError(error)) throw error;
    await api.editMessageText(chatId, messageId, chunk.plain, options);
  }
}
