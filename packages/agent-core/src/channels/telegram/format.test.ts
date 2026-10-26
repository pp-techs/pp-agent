import { describe, expect, test } from "vite-plus/test";
import { FakeApi } from "./testing.ts";
import { TelegramApiError } from "./api.ts";
import {
  editFormatted,
  escapeHtml,
  formatMessage,
  MESSAGE_LIMIT,
  markdownToTelegramHtml as html,
  sendFormatted,
  splitText,
} from "./format.ts";

describe("splitText", () => {
  test("keeps short text whole", () => {
    expect(splitText("hello")).toEqual(["hello"]);
  });

  test("prefers paragraph boundaries and respects the limit", () => {
    const paragraph = "word ".repeat(150).trim();
    const text = Array.from({ length: 10 }, () => paragraph).join("\n\n");
    const chunks = splitText(text, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1000);
      expect(chunk.endsWith(paragraph)).toBe(true);
    }
    expect(chunks.join("\n\n")).toBe(text);
  });

  test("falls back to lines, then spaces, then a hard cut", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
    const byLine = splitText(lines, 100);
    expect(byLine.join("\n")).toBe(lines);
    const words = "abc ".repeat(100).trim();
    for (const chunk of splitText(words, 50)) expect(chunk.endsWith("abc")).toBe(true);
    const solid = "x".repeat(250);
    const hard = splitText(solid, 100);
    expect(hard.join("")).toBe(solid);
    expect(Math.max(...hard.map((chunk) => chunk.length))).toBeLessThanOrEqual(100);
  });

  test("never splits a surrogate pair", () => {
    const text = "😀".repeat(200);
    const chunks = splitText(text, 101);
    expect(chunks.join("")).toBe(text);
    for (const chunk of chunks) expect(chunk.length % 2).toBe(0);
  });

  test("keeps a code block whole when it fits in a chunk", () => {
    const code = [
      "```ts",
      ...Array.from({ length: 10 }, (_, i) => `const a${i} = ${i};`),
      "```",
    ].join("\n");
    const text = `${"intro ".repeat(40).trim()}\n\n${code}\n\n${"outro ".repeat(10).trim()}`;
    const chunks = splitText(text, code.length + 20);
    expect(chunks.some((chunk) => chunk.includes(code))).toBe(true);
  });

  test("closes and re-opens a fence when a block must be cut", () => {
    const code = ["```python", ...Array.from({ length: 60 }, (_, i) => `print(${i})`), "```"].join(
      "\n",
    );
    const chunks = splitText(code, 200);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200);
      expect(chunk.startsWith("```python\n")).toBe(true);
      expect(chunk.trimEnd().endsWith("```")).toBe(true);
      expect(chunk.match(/^```/gm)?.length).toBe(2);
    }
    const printed = chunks.join("\n").match(/print\(\d+\)/g);
    expect(printed).toEqual(Array.from({ length: 60 }, (_, i) => `print(${i})`));
  });
});

describe("markdownToTelegramHtml", () => {
  test("escapes HTML characters", () => {
    expect(escapeHtml("a < b && c > d")).toBe("a &lt; b &amp;&amp; c &gt; d");
    expect(html("1 < 2 & 3 > 2")).toBe("1 &lt; 2 &amp; 3 &gt; 2");
  });

  test("converts inline styles", () => {
    expect(html("**bold** and *italic* and ~~gone~~ and `code <x>`")).toBe(
      "<b>bold</b> and <i>italic</i> and <s>gone</s> and <code>code &lt;x&gt;</code>",
    );
    expect(html("__bold__ _it_")).toBe("<b>bold</b> <i>it</i>");
  });

  test("leaves snake_case and math stars alone", () => {
    expect(html("snake_case_name and 2 * 3 * 4")).toBe("snake_case_name and 2 * 3 * 4");
  });

  test("converts links and protects their URLs from styling", () => {
    expect(html("[docs](https://a.com/x_y_z?a=1&b=2)")).toBe(
      '<a href="https://a.com/x_y_z?a=1&amp;b=2">docs</a>',
    );
    expect(html("[x](javascript:alert(1))")).toBe("[x](javascript:alert(1))");
  });

  test("renders headings as bold and lists as bullets", () => {
    expect(html("# Title\n## Sub ##\n- one\n* two\n  - nested\n1. first")).toBe(
      "<b>Title</b>\n<b>Sub</b>\n• one\n• two\n  • nested\n1. first",
    );
  });

  test("renders code blocks with an optional language and escapes their content", () => {
    expect(html("```ts\nconst a = 1 < 2;\n```")).toBe(
      '<pre><code class="language-ts">const a = 1 &lt; 2;</code></pre>',
    );
    expect(html("```\n**not bold**\n```")).toBe("<pre>**not bold**</pre>");
    expect(html("```\nunclosed")).toBe("<pre>unclosed</pre>");
  });

  test("renders quotes and tables", () => {
    expect(html("> quoted **text**\n> more")).toBe(
      "<blockquote>quoted <b>text</b>\nmore</blockquote>",
    );
    expect(html("| a | b |\n|---|---|\n| 1 | 2 |")).toBe(
      "<pre>| a | b |\n|---|---|\n| 1 | 2 |</pre>",
    );
  });

  test("falls back to escaped text when styles cross", () => {
    expect(html("**a *b** c*")).toBe("**a *b** c*");
  });
});

describe("formatMessage", () => {
  test("splits long text so every HTML chunk fits", () => {
    const text = "<tag> & more\n".repeat(900);
    const chunks = formatMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.html.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
      expect(chunk.plain.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    }
    expect(
      chunks
        .map((chunk) => chunk.plain)
        .join("\n")
        .trimEnd(),
    ).toBe(text.trimEnd());
  });
});

describe("plain-text fallback", () => {
  const parseError = new TelegramApiError("bad_request", "Bad Request: can't parse entities", 400);

  test("sendFormatted resends the plain text when Telegram cannot parse the HTML", async () => {
    const api = new FakeApi();
    api.sendError = (_, options) => (options?.parseMode ? parseError : null);
    await sendFormatted(api, 5, { html: "<b>x", plain: "**x" });
    expect(api.sent.map((message) => message.text)).toEqual(["**x"]);
    expect(api.sent[0]?.options?.parseMode).toBeUndefined();
  });

  test("editFormatted does the same, and other errors pass through", async () => {
    const api = new FakeApi();
    api.editError = (text) => (text.startsWith("<") ? parseError : null);
    await editFormatted(api, 5, 9, { html: "<b>x", plain: "**x" });
    expect(api.edits.map((edit) => edit.text)).toEqual(["**x"]);
    api.sendError = () => new TelegramApiError("network", "down");
    await expect(sendFormatted(api, 5, { html: "a", plain: "a" })).rejects.toThrow("down");
  });
});

describe("fence opener validation", () => {
  test("inline triple backticks remain inline", () => {
    expect(html("```inline code```\nnext")).toBe("<code>inline code</code>\nnext");
    expect(html("```ts extra ` invalid\nnext")).not.toContain("<pre>");
  });
  test("tilde fences still allow backticks in their info string", () => {
    expect(html("~~~abcdefghijklmnopqrstuvwxy\ncode\n~~~")).toContain(
      'class="language-abcdefghijklmnopqrstuvwxy"',
    );
    expect(html("~~~ts extra ` info\nconst n = 1;\n~~~")).toBe(
      '<pre><code class="language-ts">const n = 1;</code></pre>',
    );
  });
  test("splitting checks the entire info string, including beyond the cut", () => {
    const text = "```" + "x".repeat(300) + "```\nnext";
    const chunks = splitText(text, 100);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((chunk) => !chunk.includes("\n```"))).toBe(true);
  });
});
