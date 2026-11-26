/**
 * Per-mutation skill audit ledger + single-edit content-addressed rollback.
 *
 * Every skill mutation writes before/after SKILL.md snapshots to content-addressed SHA-256 blobs
 * under `<skillsRoot>/.skill-blobs/` and appends one JSONL entry to `<skillsRoot>/.skill-ledger.jsonl`.
 * Rollback is fail-closed: if the target snapshot blob is missing or cannot be captured safely,
 * nothing on disk is changed. Archived skills are moved under `<skillsRoot>/.archive/` and are
 * never permanently deleted.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const SKILL_FILE = "SKILL.md";
const LEDGER_FILE = ".skill-ledger.jsonl";
const BLOBS_DIR = ".skill-blobs";
const ARCHIVE_DIR = ".archive";
const MAX_LEDGER_BYTES = 5 * 1024 * 1024;
const VALID_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type SkillLedgerAction = "create" | "patch" | "archive" | "rollback";
export type SkillLedgerActor = "agent" | "user";

export interface SkillLedgerEntry {
  id: string;
  ts: string;
  actor: SkillLedgerActor;
  action: SkillLedgerAction;
  skill: string;
  beforeHash: string | null;
  afterHash: string | null;
  summary: string;
}

export interface RecordMutationInput {
  actor: SkillLedgerActor;
  action: SkillLedgerAction;
  skill: string;
  beforeContent: string | null;
  afterContent: string | null;
  summary: string;
}

export interface RollbackResult {
  entry: SkillLedgerEntry;
  restored: "content" | "archived";
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, content, "utf8");
  renameSync(temp, path);
}

function archiveStamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join("");
}

/** Verifies `candidate` stays inside `root` and is not a symlink. */
function assertInsideRoot(root: string, candidate: string): void {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (
    !rel ||
    rel.startsWith("..") ||
    rel.includes(`..${sep}`) ||
    resolvedCandidate === resolvedRoot
  ) {
    throw new Error(`Refused path outside skills root: ${candidate}`);
  }
  if (existsSync(resolvedCandidate) && lstatSync(resolvedCandidate).isSymbolicLink()) {
    throw new Error(`Refused symlink inside skills root: ${candidate}`);
  }
}

export class SkillLedger {
  constructor(readonly skillsRoot: string) {}

  get ledgerPath(): string {
    return join(this.skillsRoot, LEDGER_FILE);
  }

  get blobsDir(): string {
    return join(this.skillsRoot, BLOBS_DIR);
  }

  get archiveDir(): string {
    return join(this.skillsRoot, ARCHIVE_DIR);
  }

  /** Resolves `<skillsRoot>/<name>` after validating name, containment, and symlink safety. */
  skillDir(name: string): string {
    if (!VALID_NAME.test(name)) {
      throw new Error(`Invalid skill name "${name}". Use lowercase letters, numbers, and hyphens.`);
    }
    const dir = join(this.skillsRoot, name);
    assertInsideRoot(this.skillsRoot, dir);
    return dir;
  }

  skillFile(name: string): string {
    const dir = this.skillDir(name);
    const file = join(dir, SKILL_FILE);
    assertInsideRoot(this.skillsRoot, file);
    return file;
  }

  private storeBlob(content: string): string {
    const hash = sha256(content);
    const path = join(this.blobsDir, `${hash}.md`);
    if (!existsSync(path)) atomicWrite(path, content);
    return hash;
  }

  readBlob(hash: string): string | null {
    if (!/^[0-9a-f]{64}$/.test(hash)) return null;
    const path = join(this.blobsDir, `${hash}.md`);
    if (!existsSync(path)) return null;
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  }

  /** Records a skill mutation and stores before/after content blobs. */
  recordMutation(input: RecordMutationInput): SkillLedgerEntry {
    mkdirSync(this.skillsRoot, { recursive: true });
    const entry: SkillLedgerEntry = {
      id: randomUUID().slice(0, 12),
      ts: new Date().toISOString(),
      actor: input.actor,
      action: input.action,
      skill: input.skill,
      beforeHash: input.beforeContent === null ? null : this.storeBlob(input.beforeContent),
      afterHash: input.afterContent === null ? null : this.storeBlob(input.afterContent),
      summary: input.summary.replace(/\s+/g, " ").trim().slice(0, 200),
    };
    appendFileSync(this.ledgerPath, `${JSON.stringify(entry)}\n`, "utf8");
    this.trimIfOversized();
    return entry;
  }

  private trimIfOversized(): void {
    try {
      const raw = readFileSync(this.ledgerPath, "utf8");
      if (Buffer.byteLength(raw, "utf8") <= MAX_LEDGER_BYTES) return;
      const lines = raw.trim().split("\n");
      const kept = lines.slice(Math.floor(lines.length / 2));
      atomicWrite(this.ledgerPath, `${kept.join("\n")}\n`);
    } catch {
      // Best-effort compaction.
    }
  }

  /** Newest-first ledger entries, optionally filtered to one skill. */
  list(skill?: string, limit = 20): SkillLedgerEntry[] {
    if (!existsSync(this.ledgerPath)) return [];
    let raw: string;
    try {
      raw = readFileSync(this.ledgerPath, "utf8");
    } catch {
      return [];
    }
    const entries: SkillLedgerEntry[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as Partial<SkillLedgerEntry>;
        if (
          typeof parsed.id === "string" &&
          typeof parsed.ts === "string" &&
          typeof parsed.skill === "string" &&
          typeof parsed.action === "string"
        ) {
          if (!skill || parsed.skill === skill) {
            entries.push(parsed as SkillLedgerEntry);
          }
        }
      } catch {
        // Ignore malformed JSONL lines.
      }
    }
    return entries.reverse().slice(0, Math.max(1, Math.min(limit, 100)));
  }

  find(entryId: string): SkillLedgerEntry | null {
    return this.list(undefined, 1000).find((entry) => entry.id === entryId) ?? null;
  }

  /** Moves a skill folder into `.archive/<name>-<timestamp>` (recoverable, never deleted). */
  archiveFolder(name: string): string {
    const dir = this.skillDir(name);
    if (!existsSync(dir)) throw new Error(`Skill "${name}" does not exist.`);
    mkdirSync(this.archiveDir, { recursive: true });
    let dest = join(this.archiveDir, `${name}-${archiveStamp()}`);
    let suffix = 1;
    while (existsSync(dest)) {
      dest = join(this.archiveDir, `${name}-${archiveStamp()}-${suffix}`);
      suffix += 1;
    }
    renameSync(dir, dest);
    return dest;
  }

  /**
   * Fail-closed single-edit rollback: restores `SKILL.md` to `entry.beforeHash` (or archives a
   * newly created skill when `beforeHash` is null) and records a new rollback ledger entry.
   */
  rollback(entryId: string, actor: SkillLedgerActor = "agent"): RollbackResult {
    const target = this.find(entryId);
    if (!target) throw new Error(`No ledger entry found with id "${entryId}".`);

    const file = this.skillFile(target.skill);
    const currentContent = existsSync(file) ? readFileSync(file, "utf8") : null;

    if (target.beforeHash === null) {
      if (!existsSync(this.skillDir(target.skill))) {
        throw new Error(`Skill "${target.skill}" is already absent; nothing to roll back.`);
      }
      this.archiveFolder(target.skill);
      const entry = this.recordMutation({
        actor,
        action: "rollback",
        skill: target.skill,
        beforeContent: currentContent,
        afterContent: null,
        summary: `Rolled back ${target.action} (${target.id}) by archiving skill`,
      });
      return { entry, restored: "archived" };
    }

    const previous = this.readBlob(target.beforeHash);
    if (previous === null) {
      throw new Error(
        `Cannot roll back "${entryId}": backup blob ${target.beforeHash.slice(0, 12)} is missing.`,
      );
    }
    atomicWrite(file, previous);
    const entry = this.recordMutation({
      actor,
      action: "rollback",
      skill: target.skill,
      beforeContent: currentContent,
      afterContent: previous,
      summary: `Rolled back ${target.action} (${target.id})`,
    });
    return { entry, restored: "content" };
  }
}
