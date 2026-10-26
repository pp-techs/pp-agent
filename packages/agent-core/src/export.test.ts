import type { ChatMessage } from "@workspace/shared";
import { describe, expect, test } from "vite-plus/test";
import {
  conversationToHtml,
  conversationToMarkdown,
  escapeHtml,
  exportFileName,
  toolTarget,
  type ExportLabels,
} from "./export.ts";

const labels: ExportLabels = {
  user: "You",
  assistant: "Assistant",
  image: "image",
  skill: (name) => `Skill: ${name}`,
  attachment: (name) => `Attachment: ${name}`,
  tool: (name, target) => (target ? `Tool: ${name} · ${target}` : `Tool: ${name}`),
  exportedOn: (date) => `Exported ${date}`,
  workspace: (name) => `Workspace: ${name}`,
};

const messages: ChatMessage[] = [
  {
    id: "m1",
    role: "user",
    parts: [
      { type: "text", text: "Read <b>this</b>" },
      { type: "file", name: "report.pdf", path: "attachments/20250101-report.pdf" },
    ],
  },
  {
    id: "m2",
    role: "assistant",
    parts: [
      { type: "thinking", text: "secret thoughts" },
      {
        type: "tool",
        toolCallId: "t1",
        name: "bash",
        args: { command: "curl -H 'Authorization: Bearer abc' x" },
        status: "done",
        output: "token=abc",
      },
      {
        type: "tool",
        toolCallId: "t2",
        name: "read",
        args: { path: "src/a.ts" },
        status: "done",
      },
      { type: "text", text: "Done." },
    ],
  },
  { id: "m3", role: "assistant", parts: [{ type: "text", text: "More." }], error: "Stopped." },
];

const source = { title: "My chat", workspaceName: "Home", date: "2025-01-02", messages };

describe("toolTarget", () => {
  test("names the file, never the command", () => {
    expect(toolTarget({ path: "src/a.ts" })).toBe("src/a.ts");
    expect(toolTarget({ command: "echo $SECRET" })).toBe("");
  });

  test("drops the query string and sign-in of an address", () => {
    expect(toolTarget({ url: "https://user:pw@example.com/a/b?key=1#x" })).toBe(
      "https://example.com/a/b",
    );
  });
});

describe("exportFileName", () => {
  test("replaces characters files cannot hold", () => {
    expect(exportFileName('a/b:c*"d')).toBe("a-b-c--d");
    expect(exportFileName("   ")).toBe("chat");
  });
});

describe("conversationToMarkdown", () => {
  const markdown = conversationToMarkdown(source, labels);

  test("lists speakers, text, attachments, and tool lines", () => {
    expect(markdown).toContain("# My chat");
    expect(markdown).toContain("## You");
    expect(markdown).toContain("*Attachment: report.pdf*");
    expect(markdown).toContain("- Tool: bash\n- Tool: read · src/a.ts");
    expect(markdown).toContain("Done.");
  });

  test("leaves out thinking, tool arguments, and tool output", () => {
    expect(markdown).not.toContain("secret thoughts");
    expect(markdown).not.toContain("Bearer");
    expect(markdown).not.toContain("token=abc");
  });

  test("consecutive replies share one heading", () => {
    expect(markdown.match(/## Assistant/g)).toHaveLength(1);
    expect(markdown).toContain("> Stopped.");
  });
});

describe("conversationToHtml", () => {
  test("escapes message text", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
    const html = conversationToHtml(source, labels, "en");
    expect(html).toContain("Read &lt;b&gt;this&lt;/b&gt;");
    expect(html).not.toContain("<b>this</b>");
    expect(html).toContain('<html lang="en">');
  });
});
