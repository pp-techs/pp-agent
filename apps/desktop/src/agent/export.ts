import type { ChatMessage, ChatPart } from "@workspace/shared";

/** Texts of an exported conversation, in the app's language. */
export interface ExportLabels {
  user: string;
  assistant: string;
  image: string;
  skill: (name: string) => string;
  attachment: (name: string) => string;
  /** A tool the agent used: its name and, when known, what it worked on. */
  tool: (name: string, target: string) => string;
  exportedOn: (date: string) => string;
  workspace: (name: string) => string;
}

export interface ExportSource {
  title: string;
  workspaceName: string;
  /** Day of the export, `YYYY-MM-DD`. */
  date: string;
  messages: readonly ChatMessage[];
}

const TARGET_LENGTH = 120;
/** Arguments that name what a tool works on, in order of preference. */
const TARGET_KEYS = ["path", "file_path", "url", "query", "pattern"] as const;

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > TARGET_LENGTH ? `${flat.slice(0, TARGET_LENGTH - 1)}…` : flat;
}

/**
 * What a tool call worked on (a file, a page, a search), or "". Commands and other arguments are
 * left out, since they can hold passwords or keys; addresses lose their query string and sign-in.
 */
export function toolTarget(args: Record<string, unknown>): string {
  for (const key of TARGET_KEYS) {
    const value = args[key];
    if (typeof value !== "string" || !value.trim()) continue;
    if (key !== "url") return shorten(value);
    try {
      const url = new URL(value);
      return shorten(`${url.origin}${url.pathname}`);
    } catch {
      return "";
    }
  }
  return "";
}

/** A file name for the export, without extension. */
export function exportFileName(title: string): string {
  const name = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim();
  return name || "chat";
}

type Block =
  | { kind: "heading"; role: "user" | "assistant" }
  | { kind: "text"; text: string }
  | { kind: "note"; text: string }
  | { kind: "tools"; lines: string[] }
  | { kind: "error"; text: string };

/** The conversation as a flat list of blocks; consecutive replies of the agent share one heading. */
function toBlocks(messages: readonly ChatMessage[], labels: ExportLabels): Block[] {
  const blocks: Block[] = [];
  let speaker: "user" | "assistant" | null = null;

  const addPart = (part: ChatPart) => {
    switch (part.type) {
      case "text":
        if (part.text.trim()) blocks.push({ kind: "text", text: part.text.trim() });
        break;
      case "skill":
        blocks.push({ kind: "note", text: labels.skill(part.name) });
        break;
      case "file":
        blocks.push({ kind: "note", text: labels.attachment(part.name) });
        break;
      case "image":
        blocks.push({ kind: "note", text: labels.attachment(labels.image) });
        break;
      case "tool": {
        const line = labels.tool(part.name, toolTarget(part.args));
        const last = blocks.at(-1);
        if (last?.kind === "tools") last.lines.push(line);
        else blocks.push({ kind: "tools", lines: [line] });
        break;
      }
      case "thinking":
        break;
    }
  };

  for (const message of messages) {
    if (message.role === "compaction") continue;
    if (message.role !== speaker || message.role === "user") {
      speaker = message.role;
      blocks.push({ kind: "heading", role: message.role });
    }
    for (const part of message.parts) addPart(part);
    if (message.error) blocks.push({ kind: "error", text: message.error });
  }
  return blocks;
}

export function conversationToMarkdown(source: ExportSource, labels: ExportLabels): string {
  const out: string[] = [
    `# ${source.title.replace(/\s+/g, " ")}`,
    `*${labels.workspace(source.workspaceName)} · ${labels.exportedOn(source.date)}*`,
  ];
  for (const block of toBlocks(source.messages, labels)) {
    switch (block.kind) {
      case "heading":
        out.push(`## ${block.role === "user" ? labels.user : labels.assistant}`);
        break;
      case "text":
        out.push(block.text);
        break;
      case "note":
        out.push(`*${block.text}*`);
        break;
      case "tools":
        out.push(block.lines.map((line) => `- ${line}`).join("\n"));
        break;
      case "error":
        out.push(`> ${block.text.replace(/\s+/g, " ")}`);
        break;
    }
  }
  return `${out.join("\n\n")}\n`;
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

const HTML_STYLE = `
body { font: 15px/1.6 -apple-system, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; max-width: 760px; margin: 2rem auto; padding: 0 1rem; }
h1 { font-size: 1.6rem; margin-bottom: 0.25rem; }
.meta { color: #666; margin-top: 0; }
h2 { font-size: 1rem; margin: 1.75rem 0 0.5rem; padding-bottom: 0.25rem; border-bottom: 1px solid #ddd; }
h2.user { color: #0b5cad; }
p { white-space: pre-wrap; margin: 0.5rem 0; }
p.note { color: #666; font-style: italic; }
ul { color: #555; margin: 0.5rem 0; padding-left: 1.25rem; }
blockquote { margin: 0.5rem 0; padding: 0.25rem 0.75rem; border-left: 3px solid #c0392b; color: #c0392b; }
@media print { body { margin: 0; max-width: none; } h2 { break-after: avoid; } }
`;

/** A standalone, printable page: plain text per message (Markdown is not rendered). */
export function conversationToHtml(
  source: ExportSource,
  labels: ExportLabels,
  language: string,
): string {
  const body: string[] = [];
  for (const block of toBlocks(source.messages, labels)) {
    switch (block.kind) {
      case "heading":
        body.push(
          `<h2 class="${block.role}">${escapeHtml(block.role === "user" ? labels.user : labels.assistant)}</h2>`,
        );
        break;
      case "text":
        body.push(`<p>${escapeHtml(block.text)}</p>`);
        break;
      case "note":
        body.push(`<p class="note">${escapeHtml(block.text)}</p>`);
        break;
      case "tools":
        body.push(`<ul>${block.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`);
        break;
      case "error":
        body.push(`<blockquote>${escapeHtml(block.text)}</blockquote>`);
        break;
    }
  }
  const title = escapeHtml(source.title.replace(/\s+/g, " "));
  return [
    "<!doctype html>",
    `<html lang="${escapeHtml(language)}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<title>${title}</title>`,
    `<style>${HTML_STYLE}</style>`,
    "</head>",
    "<body>",
    `<h1>${title}</h1>`,
    `<p class="meta">${escapeHtml(labels.workspace(source.workspaceName))} · ${escapeHtml(labels.exportedOn(source.date))}</p>`,
    ...body,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
