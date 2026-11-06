import { readFileSync } from "node:fs";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { stripFrontmatter } from "@earendil-works/pi-coding-agent";

/**
 * Several skills in one message: `/skill:a /skill:b what to do`. Pi expands only a single leading
 * `/skill:` command, so a message that starts with more than one is expanded here, into one
 * `<skill>` block per skill (the same block pi writes) followed by the person's text.
 */

/** A skill pi loaded: where its SKILL.md is and the folder its references are relative to. */
export interface LoadedSkill {
  name: string;
  filePath: string;
  baseDir: string;
}

const LEADING_COMMAND = /^\/skill:(\S+)(?: +|$)/;

/** The same block as pi's own expansion, so a saved message reads back the same way. */
function skillBlock(skill: LoadedSkill): string {
  const body = stripFrontmatter(readFileSync(skill.filePath, "utf-8")).trim();
  return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
}

/**
 * Expands the `/skill:` commands a message starts with when there are two or more of them. One (or
 * none) is left to pi. A command for an unknown skill ends the run of commands; it and what follows
 * stay as the person's text.
 */
export function expandSkillChain(
  text: string,
  find: (name: string) => LoadedSkill | undefined,
): string {
  const skills: LoadedSkill[] = [];
  let rest = text;
  for (let match = LEADING_COMMAND.exec(rest); match; match = LEADING_COMMAND.exec(rest)) {
    const skill = find(match[1] ?? "");
    if (!skill) break;
    skills.push(skill);
    rest = rest.slice(match[0].length);
  }
  if (skills.length < 2) return text;
  try {
    const blocks = skills.map(skillBlock);
    const args = rest.trim();
    return args ? `${blocks.join("\n\n")}\n\n${args}` : blocks.join("\n\n");
  } catch {
    // A SKILL.md that cannot be read: pass the message through, as pi does for one skill.
    return text;
  }
}

/** Expands skill chains in every message the person sends (before pi looks at it). */
export function skillChainExtension(skills: () => readonly LoadedSkill[]): ExtensionFactory {
  return (pi) => {
    pi.on("input", (event) => {
      if (!event.text.startsWith("/skill:")) return { action: "continue" };
      const text = expandSkillChain(event.text, (name) =>
        skills().find((skill) => skill.name === name),
      );
      return text === event.text ? { action: "continue" } : { action: "transform", text };
    });
  };
}

/**
 * The skills a stored user message invoked, and the rest of it: the person's text, with any
 * attached-files block. Null when it starts with no `<skill>` block.
 */
export function parseSkillBlocks(text: string): { names: string[]; userMessage?: string } | null {
  const names: string[] = [];
  let rest = text;
  for (let match = SKILL_BLOCK.exec(rest); match; match = SKILL_BLOCK.exec(rest)) {
    names.push(match[1] ?? "");
    rest = rest.slice(match[0].length);
  }
  if (names.length === 0) return null;
  const userMessage = rest.trim();
  return userMessage ? { names, userMessage } : { names };
}

const SKILL_BLOCK = /^<skill name="([^"]+)" location="[^"]+">\n[\s\S]*?\n<\/skill>(?:\n\n|$)/;
