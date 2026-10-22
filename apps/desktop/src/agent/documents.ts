import { extname, isAbsolute, resolve } from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { OfficeParser } from "officeparser";
import { Type } from "typebox";

/** Formats officeparser understands. Plain text files are better served by the `read` tool. */
export const DOCUMENT_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".xlsx",
  ".pptx",
  ".odt",
  ".ods",
  ".odp",
  ".rtf",
  ".epub",
  ".html",
  ".htm",
  ".csv",
];

/** Keeps one large report from filling the context window; the agent can ask for later pages. */
const MAX_CHARS = 60_000;

export function createReadDocumentTool(workspaceDir: string) {
  return defineTool({
    name: "read_document",
    label: "Read document",
    description:
      `Converts an office document or PDF to Markdown and returns it. Supports ${DOCUMENT_EXTENSIONS.join(", ")}. ` +
      "Relative paths resolve against the workspace. Long documents are cut off; pass `pages` (for example `5-10`) to read later PDF pages.",
    promptSnippet: "Read PDF, Word, Excel, PowerPoint, and other office documents as Markdown",
    promptGuidelines: ["Use read_document, not read, for PDF, Word, Excel, and PowerPoint files"],
    parameters: Type.Object({
      path: Type.String({
        description: "Path to the document, absolute or relative to the workspace",
      }),
      pages: Type.Optional(
        Type.String({
          description: "PDF page range such as `1-5` or `3,7,9`. Ignored for other formats.",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      const path = isAbsolute(params.path) ? params.path : resolve(workspaceDir, params.path);
      const extension = extname(path).toLowerCase();
      if (!DOCUMENT_EXTENSIONS.includes(extension)) {
        throw new Error(
          `read_document does not support ${extension || "files without an extension"}; use read for plain text.`,
        );
      }
      const ast = await OfficeParser.parseOffice(path, {
        abortSignal: signal ?? null,
        ignoreComments: true,
        ...(params.pages ? { pdfParserConfig: { pageRange: params.pages } } : {}),
      });
      const markdown = (await ast.to("md")).value;
      const truncated = markdown.length > MAX_CHARS;
      const text = truncated
        ? `${markdown.slice(0, MAX_CHARS)}\n\n[Truncated: showing ${MAX_CHARS} of ${markdown.length} characters. For PDFs, request later pages with \`pages\`.]`
        : markdown;
      return {
        content: [{ type: "text", text: text || "(The document contains no text.)" }],
        details: undefined,
      };
    },
  });
}
