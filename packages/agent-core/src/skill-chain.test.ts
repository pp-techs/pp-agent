import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSkillBlock } from "@earendil-works/pi-coding-agent";
import { describe, expect, test } from "vite-plus/test";
import { expandSkillChain, parseSkillBlocks, type LoadedSkill } from "./skill-chain.ts";

const root = mkdtempSync(join(tmpdir(), "skill-chain-"));
function skill(name: string, body: string): LoadedSkill {
  const baseDir = join(root, name);
  mkdirSync(baseDir, { recursive: true });
  const filePath = join(baseDir, "SKILL.md");
  writeFileSync(filePath, `---\nname: ${name}\ndescription: ${name}\n---\n\n${body}\n`);
  return { name, filePath, baseDir };
}
const skills = [skill("pdf", "Merge PDFs."), skill("brainstorm", "Shape ideas.")];
const find = (name: string) => skills.find((entry) => entry.name === name);

describe("expandSkillChain", () => {
  test("expands two leading skills into blocks, then the text", () => {
    const text = expandSkillChain("/skill:pdf /skill:brainstorm do it", find);
    expect(text.indexOf('<skill name="pdf"')).toBe(0);
    expect(text.indexOf('<skill name="brainstorm"')).toBeGreaterThan(0);
    expect(text).toContain("Merge PDFs.");
    expect(text).toContain("Shape ideas.");
    expect(text.endsWith("</skill>\n\ndo it")).toBe(true);
    // The frontmatter is not passed on.
    expect(text).not.toContain("description:");
  });

  test("leaves a single skill to pi", () => {
    expect(expandSkillChain("/skill:pdf do it", find)).toBe("/skill:pdf do it");
    expect(expandSkillChain("plain", find)).toBe("plain");
  });

  test("an unknown skill ends the chain and stays as text", () => {
    const text = expandSkillChain("/skill:pdf /skill:brainstorm /skill:nope go", find);
    expect(text.endsWith("</skill>\n\n/skill:nope go")).toBe(true);
    expect(expandSkillChain("/skill:pdf /skill:nope go", find)).toBe("/skill:pdf /skill:nope go");
  });

  test("skills alone, without text", () => {
    const text = expandSkillChain("/skill:pdf /skill:brainstorm", find);
    expect(text.endsWith("</skill>")).toBe(true);
  });
});

describe("parseSkillBlocks", () => {
  test("reads back every skill and the person's text", () => {
    const stored = expandSkillChain("/skill:pdf /skill:brainstorm do it", find);
    expect(parseSkillBlocks(stored)).toEqual({
      names: ["pdf", "brainstorm"],
      userMessage: "do it",
    });
    const alone = expandSkillChain("/skill:pdf /skill:brainstorm", find);
    expect(parseSkillBlocks(alone)).toEqual({ names: ["pdf", "brainstorm"] });
  });

  test("agrees with pi on a message of one skill", () => {
    const stored = `<skill name="pdf" location="/x/SKILL.md">\nReferences are relative to /x.\n\nBody\n</skill>\n\nhello`;
    expect(parseSkillBlocks(stored)).toEqual({ names: ["pdf"], userMessage: "hello" });
    expect(parseSkillBlock(stored)?.userMessage).toBe("hello");
  });

  test("a message without a skill block is not one", () => {
    expect(parseSkillBlocks("just text")).toBeNull();
  });
});
