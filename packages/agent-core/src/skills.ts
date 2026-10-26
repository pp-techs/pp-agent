import { existsSync, realpathSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, posix, relative } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { SaveSkillInput, SkillDetail, SkillSummary } from "@workspace/shared";
import { unzipSync } from "fflate";
import { stringify } from "yaml";
import { t } from "./i18n.ts";

const SKILL_FILE = "SKILL.md";
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
/** Archives that expand beyond this are refused, so a zip bomb cannot fill the disk. */
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
/** Files and folders that archive tools and OSes add and that are never part of a skill. */
const IGNORED: Record<string, true> = {
  __MACOSX: true,
  ".git": true,
  node_modules: true,
  ".DS_Store": true,
};

interface SkillFile {
  name: string;
  description: string;
  modelInvocable: boolean;
  frontmatter: Record<string, unknown>;
  body: string;
}

/** Same rules pi applies when it loads a skill (see `validateName` in pi's core/skills.js). */
export function validateSkillName(name: string): void {
  if (!name) throw new Error(t("skills.nameRequired"));
  if (name.length > MAX_NAME_LENGTH)
    throw new Error(t("limits.nameTooLong", { max: MAX_NAME_LENGTH }));
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) throw new Error(t("skills.nameFormat"));
}

function validateDescription(description: string): void {
  if (!description.trim()) throw new Error(t("skills.descriptionRequired"));
  if (description.length > MAX_DESCRIPTION_LENGTH)
    throw new Error(t("limits.descriptionTooLong", { max: MAX_DESCRIPTION_LENGTH }));
}

function parseSkill(content: string, fallbackName: string): SkillFile {
  let frontmatter: Record<string, unknown> = {};
  let body = content;
  try {
    ({ frontmatter, body } = parseFrontmatter(content));
  } catch {
    // Unreadable frontmatter: show the whole file as the body so nothing is lost when editing.
  }
  const name =
    typeof frontmatter.name === "string" && frontmatter.name ? frontmatter.name : fallbackName;
  const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
  return {
    name,
    description,
    modelInvocable: frontmatter["disable-model-invocation"] !== true,
    frontmatter,
    body,
  };
}

function serializeSkill(frontmatter: Record<string, unknown>, body: string): string {
  return `---\n${stringify(frontmatter).trimEnd()}\n---\n\n${body.trim()}\n`;
}

/** Skills in `<agentDir>/skills`, one folder per skill with a SKILL.md. */
export class SkillLibrary {
  /** `dir` with symlinks resolved; pi reports skill folders by their real path. */
  private readonly realDir: string;

  /** Names of the unedited skills that ship with the app (see `skills-builtin.ts`). */
  builtIn = new Set<string>();

  /** `dir` must exist. */
  constructor(readonly dir: string) {
    this.realDir = realpathSync(dir);
  }

  /** Whether pi may load the skill at `baseDir`: only skills of this library are used. */
  owns(baseDir: string): boolean {
    const inside = relative(this.realDir, existsSync(baseDir) ? realpathSync(baseDir) : baseDir);
    return inside !== "" && !inside.startsWith("..") && !isAbsolute(inside);
  }

  async list(disabled: readonly string[]): Promise<SkillSummary[]> {
    const skills = await this.scan();
    return skills
      .map(({ path, skill }) => this.summary(path, skill, disabled))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(name: string, disabled: readonly string[]): Promise<SkillDetail> {
    const { path, skill } = await this.find(name);
    const files = (await listFiles(path)).filter((file) => file !== SKILL_FILE);
    return { ...this.summary(path, skill, disabled), body: skill.body, files };
  }

  /** Creates or edits a skill. Renaming moves its folder. */
  async save(input: SaveSkillInput, disabled: readonly string[]): Promise<SkillSummary> {
    const name = input.name.trim();
    const description = input.description.trim();
    validateSkillName(name);
    validateDescription(description);

    let frontmatter: Record<string, unknown> = {};
    let path = join(this.dir, name);
    if (input.originalName) {
      const existing = await this.find(input.originalName);
      frontmatter = existing.skill.frontmatter;
      if (name !== existing.skill.name) {
        await this.assertFree(name);
        await rename(existing.path, path);
      } else {
        path = existing.path;
      }
    } else {
      await this.assertFree(name);
      await mkdir(path, { recursive: true });
    }

    const next: Record<string, unknown> = { ...frontmatter, name, description };
    if (input.modelInvocable) delete next["disable-model-invocation"];
    else next["disable-model-invocation"] = true;
    await writeFile(join(path, SKILL_FILE), serializeSkill(next, input.body));
    // An edited copy is the person's now; it is no longer replaced by app updates.
    this.builtIn.delete(input.originalName ?? name);
    this.builtIn.delete(name);
    return this.summary(
      path,
      parseSkill(await readFile(join(path, SKILL_FILE), "utf8"), name),
      disabled,
    );
  }

  async delete(name: string): Promise<void> {
    const { path } = await this.find(name);
    await rm(path, { recursive: true, force: true });
  }

  /** Copies a skill folder, or extracts a .zip/.skill archive; every folder with a SKILL.md is one skill. */
  async import(source: string, disabled: readonly string[]): Promise<SkillSummary[]> {
    const info = await stat(source);
    const staged = info.isDirectory()
      ? await stageFolder(source)
      : stageArchive(await readFile(source), basename(source, extname(source)));
    if (staged.length === 0) throw new Error(t("skills.noSkillFile"));

    const seen = new Set<string>();
    for (const skill of staged) {
      validateSkillName(skill.name);
      if (!skill.description.trim())
        throw new Error(t("skills.missingDescription", { name: skill.name }));
      if (seen.has(skill.name))
        throw new Error(t("skills.duplicateInImport", { name: skill.name }));
      seen.add(skill.name);
      await this.assertFree(skill.name);
    }

    await mkdir(this.dir, { recursive: true });
    const imported: SkillSummary[] = [];
    for (const skill of staged) {
      const target = join(this.dir, skill.name);
      await skill.write(target);
      const parsed = parseSkill(await readFile(join(target, SKILL_FILE), "utf8"), skill.name);
      imported.push(this.summary(target, parsed, disabled));
    }
    return imported;
  }

  private summary(path: string, skill: SkillFile, disabled: readonly string[]): SkillSummary {
    return {
      name: skill.name,
      description: skill.description,
      enabled: !disabled.includes(skill.name),
      path,
      modelInvocable: skill.modelInvocable,
      builtIn: this.builtIn.has(skill.name),
    };
  }

  private async scan(): Promise<Array<{ path: string; skill: SkillFile }>> {
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const skills: Array<{ path: string; skill: SkillFile }> = [];
    for (const entry of entries) {
      const path = join(this.dir, entry);
      const file = join(path, SKILL_FILE);
      if (!existsSync(file)) continue;
      skills.push({ path, skill: parseSkill(await readFile(file, "utf8"), entry) });
    }
    return skills;
  }

  private async find(name: string): Promise<{ path: string; skill: SkillFile }> {
    const found = (await this.scan()).find((entry) => entry.skill.name === name);
    if (!found) throw new Error(t("skills.notFound", { name }));
    return found;
  }

  private async assertFree(name: string): Promise<void> {
    const taken =
      existsSync(join(this.dir, name)) ||
      (await this.scan()).some((entry) => entry.skill.name === name);
    if (taken) throw new Error(t("skills.nameTaken", { name }));
  }
}

interface StagedSkill {
  name: string;
  description: string;
  write(target: string): Promise<void>;
}

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    if (IGNORED[entry.name] === true) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listFiles(root, path)));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

/** A skill folder, or a folder whose subfolders are skills. */
async function stageFolder(source: string): Promise<StagedSkill[]> {
  const roots: string[] = [];
  if (existsSync(join(source, SKILL_FILE))) {
    roots.push(source);
  } else {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(source, entry.name, SKILL_FILE)))
        roots.push(join(source, entry.name));
    }
  }
  const staged: StagedSkill[] = [];
  for (const root of roots) {
    const skill = parseSkill(await readFile(join(root, SKILL_FILE), "utf8"), basename(root));
    staged.push({
      name: skill.name,
      description: skill.description,
      write: (target) =>
        cp(root, target, {
          recursive: true,
          filter: (path) => IGNORED[basename(path)] !== true,
        }),
    });
  }
  return staged;
}

/** Archive entry path, or null for entries that are not files of a skill. Rejects path traversal. */
function archivePath(name: string): string | null {
  const normalized = name.replaceAll("\\", "/");
  if (normalized.endsWith("/")) return null;
  if (
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split("/").includes("..")
  )
    throw new Error(t("skills.unsafeArchive"));
  const clean = posix.normalize(normalized);
  const parts = clean.split("/");
  if (parts.some((part) => IGNORED[part] === true)) return null;
  return clean;
}

function stageArchive(data: Buffer, archiveName: string): StagedSkill[] {
  let total = 0;
  const entries = unzipSync(new Uint8Array(data), {
    filter: (file) => {
      total += file.originalSize;
      if (total > MAX_ARCHIVE_BYTES) throw new Error(t("skills.archiveTooLarge"));
      return true;
    },
  });
  const files = new Map<string, Uint8Array>();
  for (const [name, content] of Object.entries(entries)) {
    const path = archivePath(name);
    if (path) files.set(path, content);
  }

  const roots = [...files.keys()]
    .filter((path) => posix.basename(path) === SKILL_FILE)
    .map((path) => posix.dirname(path))
    .map((dir) => (dir === "." ? "" : dir));
  const decoder = new TextDecoder();
  return roots.map((root) => {
    const prefix = root ? `${root}/` : "";
    const skillFile = files.get(`${prefix}${SKILL_FILE}`) ?? new Uint8Array();
    const skill = parseSkill(decoder.decode(skillFile), root ? posix.basename(root) : archiveName);
    // Files of a nested skill belong to that skill, not to this one.
    const nested = roots.filter(
      (other) => other !== root && (root === "" || other.startsWith(prefix)),
    );
    const own = [...files].filter(
      ([path]) => path.startsWith(prefix) && !nested.some((other) => path.startsWith(`${other}/`)),
    );
    return {
      name: skill.name,
      description: skill.description,
      async write(target: string) {
        for (const [path, content] of own) {
          const destination = join(target, ...path.slice(prefix.length).split("/"));
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, content);
        }
      },
    };
  });
}
