import { describe, expect, test } from "vite-plus/test";
import { createI18n, matchLanguage, resolveLanguage, resources } from "./index.ts";

type Tree = { [key: string]: string | Tree };

/** `{ a: { b: "x" } }` → `Map { "a.b" → "x" }`. */
function flatten(tree: Tree, prefix = "", out = new Map<string, string>()): Map<string, string> {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else flatten(value, path, out);
  }
  return out;
}

const placeholders = (text: string) =>
  [...text.matchAll(/\{\{\s*(\w+)[^}]*\}\}/g)].map((m) => m[1]).sort();

const en = flatten(resources.en);
const vi = flatten(resources.vi);

describe("Vietnamese resources", () => {
  test("have no keys English lacks (they would never be shown)", () => {
    const extra = [...vi.keys()].filter((key) => !en.has(key));
    expect(extra).toEqual([]);
  });

  test("use the same {{placeholders}} as English, so no value is lost in translation", () => {
    const mismatched = [...vi]
      .filter(([key]) => en.has(key))
      .filter(([key, text]) => placeholders(text).join() !== placeholders(en.get(key) ?? "").join())
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });

  test("have an `_other` form wherever English has a plural", () => {
    const missing = [...en.keys()]
      .filter((key) => key.endsWith("_one"))
      .map((key) => `${key.slice(0, -"_one".length)}_other`)
      .filter((key) => !vi.has(key));
    expect(missing).toEqual([]);
  });

  test("are not empty", () => {
    expect([...vi].filter(([, text]) => text.trim() === "").map(([key]) => key)).toEqual([]);
  });
});

describe("language choice", () => {
  test("follows the system locale only when the setting is `system`", () => {
    expect(resolveLanguage("system", "vi-VN")).toBe("vi");
    expect(resolveLanguage("system", "en-US")).toBe("en");
    expect(resolveLanguage("en", "vi")).toBe("en");
    expect(resolveLanguage("vi", "en-US")).toBe("vi");
  });

  test("falls back to English for languages that are not translated", () => {
    expect(matchLanguage("fr-FR")).toBe("en");
    expect(matchLanguage("")).toBe("en");
    expect(matchLanguage(undefined)).toBe("en");
  });

  test("switches synchronously and picks the right plural form", () => {
    const i18n = createI18n("en");
    const t = i18n.getFixedT(null, "extensions");
    expect(t("mcp.toolCount", { count: 1 })).toBe("1 tool");
    expect(t("mcp.toolCount", { count: 3 })).toBe("3 tools");
    void i18n.changeLanguage("vi");
    expect(t("mcp.toolCount", { count: 1 })).toBe("1 công cụ");
    expect(t("mcp.toolCount", { count: 3 })).toBe("3 công cụ");
  });
});
