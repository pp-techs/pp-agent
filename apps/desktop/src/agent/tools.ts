import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ToolTier } from "@workspace/shared";
import { Type } from "typebox";

/** Example business tool. Replace or extend with tools that reach your own systems. */
export const currentDateTimeTool = defineTool({
  name: "current_datetime",
  label: "Current date and time",
  description: "Returns the current local date, time, and time zone of the user's computer.",
  promptSnippet: "Get the user's current local date, time, and time zone",
  parameters: Type.Object({}),
  async execute() {
    const now = new Date();
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return {
      content: [{ type: "text", text: `${now.toString()} (time zone: ${zone})` }],
      details: undefined,
    };
  },
});

/**
 * Changes to pi's default tool set (read, bash, edit, write). No shell and no in-place editing:
 * business users get read access to their workspace plus the ability to save new files, which
 * always asks first. Custom tools (`read_document`, `current_datetime`) and the tools of MCP servers
 * configured in `<agentDir>/mcp.json` are added on top; the MCP extension activates `codemode` and
 * `tool_search` when a server needs them.
 */
export const TOOL_SELECTION = ["-bash", "-edit", "+ls", "+find", "+grep"];

/** Never run, even when a codemode script tries to call them. */
export const BLOCKED_TOOLS: Record<string, true> = { bash: true, edit: true, powershell: true };

const TIERS: Record<string, ToolTier> = {
  read: "read",
  ls: "read",
  find: "read",
  grep: "read",
  read_document: "read",
  [currentDateTimeTool.name]: "read",
  write: "write",
  // codemode only computes; every tool its script calls passes through the approval gate itself.
  codemode: "read",
  tool_search: "read",
  list_mcp_resources: "read",
  list_mcp_resource_templates: "read",
  read_mcp_resource: "read",
};

const MCP_PREFIX = "mcp__";

/** `mcp__crm__find_customer` → `{ server: "crm", tool: "find_customer" }`. */
export function parseMcpToolName(toolName: string): { server: string; tool: string } | null {
  if (!toolName.startsWith(MCP_PREFIX)) return null;
  const rest = toolName.slice(MCP_PREFIX.length);
  const split = rest.indexOf("__");
  return split === -1
    ? { server: rest, tool: rest }
    : { server: rest.slice(0, split), tool: rest.slice(split + 2) };
}

/**
 * MCP tools run freely only when their server marks them read-only; everything else asks.
 * Unknown tools are treated as `exec` so a newly added tool asks before it runs.
 */
export function toolTier(toolName: string, annotations?: { readOnlyHint?: boolean }): ToolTier {
  if (toolName.startsWith(MCP_PREFIX)) return annotations?.readOnlyHint ? "read" : "write";
  return TIERS[toolName] ?? "exec";
}

const PREVIEW_LIMIT = 600;

function preview(text: string): string {
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}\n…` : text;
}

export function describeToolCall(
  toolName: string,
  input: Record<string, unknown>,
): { title: string; detail: string } {
  if (toolName === "write") {
    const path = typeof input.path === "string" ? input.path : "a file";
    const content = typeof input.content === "string" ? input.content : "";
    return { title: `Save ${path}`, detail: preview(content) };
  }
  const mcp = parseMcpToolName(toolName);
  if (mcp) {
    return {
      title: `Use “${mcp.tool}” in ${mcp.server}`,
      detail: preview(JSON.stringify(input, null, 2)),
    };
  }
  return { title: `Run ${toolName}`, detail: preview(JSON.stringify(input, null, 2)) };
}

export const SYSTEM_PROMPT = `You are PP Agent, an assistant for business teams. You help with research, writing, analysis, and everyday office work.

Work with the files in the user's workspace folder. You can read and search them, read office documents and PDFs with read_document, and save new files there; saving always asks the user first. Files the user attaches are copied into the workspace and listed in an <attached_files> block at the end of their message.

Your team may also connect business systems (CRM, drives, email, and others) as tools. Use them when they fit the request; actions that change data ask the user first.

- Write for a non-technical reader: plain language, short paragraphs, no jargon unless the user uses it.
- Ask a brief clarifying question when a request is ambiguous instead of guessing.
- When you rely on a file, name it so the user can open it.
- Never claim you did something you did not do.`;
