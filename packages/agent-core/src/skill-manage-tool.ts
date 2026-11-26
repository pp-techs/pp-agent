/**
 * `skill_manage`: structured, guarded skill management for workspace skills (`.agents/skills/`).
 *
 * Read-only actions (`list`, `read`, `history`) run freely; mutating actions (`create`, `patch`,
 * `archive`, `rollback`) are write-tier and pass through the approval gate.
 *
 * Guards:
 * - Read-before-write: `patch` refuses unless `read` was called on that skill in this session.
 * - Secret scan: refuses to save raw secrets or API keys into a reusable skill.
 * - Single-match patch: `oldText` must appear exactly once in `SKILL.md`.
 * - Audit ledger + rollback: every mutation writes SHA-256 blobs so any edit can be undone.
 * - Never permanently deletes: `archive` moves the skill into `.archive/`.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { defineTool, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { ToolTier } from "@workspace/shared";
import { Type } from "typebox";
import { stringify } from "yaml";
import { redactSecrets, stripInvisible } from "./redact.ts";
import { SkillLedger } from "./skill-ledger.ts";
import { validateSkillName, workspaceSkillsDir } from "./skills.ts";

export const SKILL_MANAGE_TOOL = "skill_manage";

const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_BODY_CHARS = 50_000;
const SKILL_FILE = "SKILL.md";

export type SkillManageAction =
  | "list"
  | "read"
  | "history"
  | "create"
  | "patch"
  | "archive"
  | "rollback";

const READ_ACTIONS = new Set<string>(["list", "read", "history"]);

/** Read-only skill inspection runs freely; mutations always go through the write approval gate. */
export function skillManageActionTier(action: unknown): ToolTier {
  return typeof action === "string" && READ_ACTIONS.has(action) ? "read" : "write";
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, content, "utf8");
  renameSync(temp, path);
}

function assertNoSecrets(text: string): void {
  if (redactSecrets(text) !== text) {
    throw new Error(
      "Refused: the skill content appears to contain a secret, API key, token, or private key. Remove sensitive values before saving a reusable skill.",
    );
  }
}

function serializeSkill(name: string, description: string, body: string): string {
  const frontmatter = { name, description };
  return `---\n${stringify(frontmatter).trimEnd()}\n---\n\n${body.trim()}\n`;
}

function listSkillsIn(root: string): { name: string; description: string; path: string }[] {
  if (!existsSync(root)) return [];
  const items: { name: string; description: string; path: string }[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const file = join(root, entry.name, SKILL_FILE);
    if (!existsSync(file)) continue;
    try {
      const content = readFileSync(file, "utf8");
      const parsed = parseFrontmatter(content);
      const name =
        typeof parsed.frontmatter.name === "string" && parsed.frontmatter.name
          ? parsed.frontmatter.name
          : entry.name;
      const description =
        typeof parsed.frontmatter.description === "string" ? parsed.frontmatter.description : "";
      items.push({ name, description, path: file });
    } catch {
      items.push({ name: entry.name, description: "", path: file });
    }
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

/** Human-readable approval card title and diff/summary preview for `skill_manage`. */
export function describeSkillManageCall(input: Record<string, unknown>): {
  title: string;
  detail: string;
} {
  const action = typeof input.action === "string" ? input.action : "";
  const name = typeof input.name === "string" ? input.name : "";
  const entryId = typeof input.entryId === "string" ? input.entryId : "";

  if (action === "create") {
    const description = typeof input.description === "string" ? input.description : "";
    const body = typeof input.body === "string" ? input.body : "";
    const preview = body.length > 600 ? `${body.slice(0, 600)}…` : body;
    return {
      title: `Create skill "${name || "new"}"`,
      detail: [description ? `Description: ${description}` : "", preview]
        .filter(Boolean)
        .join("\n\n"),
    };
  }
  if (action === "patch") {
    const oldText = typeof input.oldText === "string" ? input.oldText : "";
    const newText = typeof input.newText === "string" ? input.newText : "";
    const diff = [
      ...oldText.split("\n").map((line) => `- ${line}`),
      ...newText.split("\n").map((line) => `+ ${line}`),
    ].join("\n");
    return {
      title: `Update skill "${name}"`,
      detail: diff.length > 800 ? `${diff.slice(0, 800)}…` : diff,
    };
  }
  if (action === "archive") {
    return {
      title: `Archive skill "${name}"`,
      detail: `Moves .agents/skills/${name} to .agents/skills/.archive/ (recoverable).`,
    };
  }
  if (action === "rollback") {
    return {
      title: `Roll back skill edit "${entryId}"`,
      detail: `Restores the previous snapshot recorded in ledger entry ${entryId}.`,
    };
  }
  return {
    title: `Manage skill (${action || "unknown"})`,
    detail: JSON.stringify(input, null, 2),
  };
}

export interface SkillManageOptions {
  /** Workspace folder; skills live under `<cwd>/.agents/skills/`. */
  cwd: string;
  /** Optional callback invoked after any mutation succeeds (e.g. to notify UI / reload). */
  onMutated?: () => void;
}

export function createSkillManageTool(options: SkillManageOptions) {
  const skillsRoot = workspaceSkillsDir(options.cwd);
  const ledger = new SkillLedger(skillsRoot, options.cwd);
  /** Read-before-write guard: tracks which skills were read in this session. */
  const readMarks = new Set<string>();

  return defineTool({
    name: SKILL_MANAGE_TOOL,
    label: "Manage skills",
    description:
      "Create, inspect, patch, archive, and roll back reusable workspace skills under .agents/skills/. " +
      "Use `list` to see existing skills, `read` to read a skill's SKILL.md (required before `patch`), " +
      "`create` to save a new reusable workflow as a skill, `patch` to make a targeted edit to an existing skill " +
      "(preferred over rewriting), `archive` to safely retire a skill (recoverable), `history` to view the audit ledger, " +
      "and `rollback` to undo a specific ledger entry. Never include client-specific secrets, passwords, or one-off data.",
    promptSnippet:
      "Create, read, patch, archive, and roll back reusable workspace skills (.agents/skills/)",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("list"),
        Type.Literal("read"),
        Type.Literal("history"),
        Type.Literal("create"),
        Type.Literal("patch"),
        Type.Literal("archive"),
        Type.Literal("rollback"),
      ]),
      name: Type.Optional(
        Type.String({
          description:
            "Skill name (lowercase letters, numbers, hyphens, e.g. 'monthly-invoice-check'). Required for read/create/patch/archive; optional filter for history.",
        }),
      ),
      description: Type.Optional(
        Type.String({
          description: "create: concise one-sentence description of when to use this skill",
        }),
      ),
      body: Type.Optional(
        Type.String({
          description:
            "create: markdown instructions for the skill (reusable steps, no secrets or one-off data)",
        }),
      ),
      oldText: Type.Optional(
        Type.String({
          description: "patch: exact text currently in SKILL.md to replace (must appear once)",
        }),
      ),
      newText: Type.Optional(
        Type.String({
          description: "patch: replacement text",
        }),
      ),
      summary: Type.Optional(
        Type.String({
          description: "Optional short reason recorded in the skill audit ledger",
        }),
      ),
      entryId: Type.Optional(
        Type.String({
          description: "rollback: ledger entry id from `history` to undo",
        }),
      ),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 50,
          description: "history: maximum ledger entries to return (default 15)",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const ok = (text: string) => ({
        content: [{ type: "text" as const, text }],
        details: undefined,
      });

      if (params.action === "list") {
        const skills = listSkillsIn(skillsRoot);
        if (skills.length === 0) return ok("No workspace skills found under .agents/skills/.");
        return ok(
          skills
            .map(
              (s) => `- ${s.name}${s.description ? `: ${s.description}` : ""}\n  path: ${s.path}`,
            )
            .join("\n"),
        );
      }

      if (params.action === "history") {
        const entries = ledger.list(params.name?.trim() || undefined, params.limit ?? 15);
        if (entries.length === 0) return ok("No skill changes recorded in the ledger yet.");
        return ok(
          entries
            .map(
              (entry) =>
                `- id: ${entry.id} | ${entry.ts} | ${entry.action} | ${entry.skill} (${entry.actor})\n  ${entry.summary}`,
            )
            .join("\n"),
        );
      }

      if (params.action === "rollback") {
        const entryId = params.entryId?.trim();
        if (!entryId) throw new Error("`entryId` is required for rollback.");
        const result = ledger.rollback(entryId, "agent");
        options.onMutated?.();
        return ok(
          `Rolled back entry ${entryId} for skill "${result.entry.skill}" (${result.restored}). New ledger entry: ${result.entry.id}.`,
        );
      }

      const name = params.name?.trim() ?? "";
      if (!name) throw new Error(`\`name\` is required for ${params.action}.`);
      validateSkillName(name);
      const file = ledger.skillFile(name);

      if (params.action === "read") {
        if (!existsSync(file)) throw new Error(`Skill "${name}" not found at ${file}.`);
        const content = readFileSync(file, "utf8");
        readMarks.add(name);
        return ok(content);
      }

      if (params.action === "create") {
        if (existsSync(file)) {
          throw new Error(
            `Skill "${name}" already exists. Use action "read" then "patch" to update it.`,
          );
        }
        const description = stripInvisible(params.description ?? "").trim();
        if (!description) throw new Error("`description` is required for create.");
        if (description.length > MAX_DESCRIPTION_LENGTH) {
          throw new Error(`Description is too long (max ${MAX_DESCRIPTION_LENGTH} characters).`);
        }
        const body = stripInvisible(params.body ?? "").trim();
        if (!body) throw new Error("`body` is required for create.");
        if (body.length > MAX_BODY_CHARS) {
          throw new Error(`Skill body is too long (max ${MAX_BODY_CHARS} characters).`);
        }
        assertNoSecrets(`${description}\n${body}`);
        const content = serializeSkill(name, description, body);
        const dir = ledger.skillDir(name);
        atomicWrite(file, content);
        let entry;
        try {
          entry = ledger.recordMutation({
            actor: "agent",
            action: "create",
            skill: name,
            beforeContent: null,
            afterContent: content,
            summary: params.summary?.trim() || `Created skill ${name}`,
          });
        } catch (error) {
          try {
            rmSync(dir, { recursive: true, force: true });
          } catch {
            // Best-effort cleanup.
          }
          throw error;
        }
        readMarks.add(name);
        options.onMutated?.();
        return ok(
          `Created skill "${name}" at ${file} (ledger entry: ${entry.id}). It will load after this turn settles when workspace skills are trusted.`,
        );
      }

      if (params.action === "patch") {
        if (!existsSync(file)) throw new Error(`Skill "${name}" not found at ${file}.`);
        if (!readMarks.has(name)) {
          throw new Error(
            `Read-before-write guard: call skill_manage with action "read" and name "${name}" before patching it so you edit the exact current file.`,
          );
        }
        const oldText = params.oldText ?? "";
        const newText = stripInvisible(params.newText ?? "");
        if (!oldText) throw new Error("`oldText` is required for patch.");
        if (oldText === newText) throw new Error("`newText` is identical to `oldText`.");

        const current = readFileSync(file, "utf8");
        const first = current.indexOf(oldText);
        if (first === -1) {
          throw new Error(
            `Could not find \`oldText\` in ${file}. Re-read the skill and try again.`,
          );
        }
        if (current.indexOf(oldText, first + 1) !== -1) {
          throw new Error(
            `\`oldText\` matched more than once in ${file}. Provide a longer, unique snippet.`,
          );
        }
        const updated = `${current.slice(0, first)}${newText}${current.slice(first + oldText.length)}`;
        // Scan the entire spliced file so split-secret fragments cannot bypass redaction.
        assertNoSecrets(updated);
        if (updated.length > MAX_BODY_CHARS + MAX_DESCRIPTION_LENGTH) {
          throw new Error(`Updated skill exceeds maximum size (${MAX_BODY_CHARS} characters).`);
        }
        // Validate that frontmatter still parses cleanly after the patch.
        const parsed = parseFrontmatter(updated);
        if (
          typeof parsed.frontmatter.description !== "string" ||
          !parsed.frontmatter.description.trim()
        ) {
          throw new Error("Patched SKILL.md must keep a non-empty frontmatter `description`.");
        }
        atomicWrite(file, updated);
        let entry;
        try {
          entry = ledger.recordMutation({
            actor: "agent",
            action: "patch",
            skill: name,
            beforeContent: current,
            afterContent: updated,
            summary: params.summary?.trim() || `Patched skill ${name}`,
          });
        } catch (error) {
          try {
            atomicWrite(file, current);
          } catch {
            // Best-effort restore.
          }
          throw error;
        }
        options.onMutated?.();
        return ok(
          `Patched skill "${name}" at ${file} (ledger entry: ${entry.id}). Use action "rollback" with entryId "${entry.id}" to undo.`,
        );
      }

      if (params.action === "archive") {
        if (!existsSync(file)) throw new Error(`Skill "${name}" not found at ${file}.`);
        const dir = ledger.skillDir(name);
        const current = readFileSync(file, "utf8");
        const archivedTo = ledger.archiveFolder(name);
        let entry;
        try {
          entry = ledger.recordMutation({
            actor: "agent",
            action: "archive",
            skill: name,
            beforeContent: current,
            afterContent: null,
            summary: params.summary?.trim() || `Archived skill ${name}`,
            archivedName: basename(archivedTo),
          });
        } catch (error) {
          try {
            renameSync(archivedTo, dir);
          } catch {
            // Best-effort restore.
          }
          throw error;
        }
        readMarks.delete(name);
        options.onMutated?.();
        return ok(
          `Archived skill "${name}" to ${archivedTo} (ledger entry: ${entry.id}). Use action "rollback" with entryId "${entry.id}" to restore.`,
        );
      }

      throw new Error(`Unsupported action: ${String(params.action)}`);
    },
  });
}
