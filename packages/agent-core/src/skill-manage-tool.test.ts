import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppSettings } from "@workspace/shared";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { SkillLedger } from "./skill-ledger.ts";
import {
  createSkillManageTool,
  describeSkillManageCall,
  SKILL_MANAGE_TOOL,
  skillManageActionTier,
} from "./skill-manage-tool.ts";
import { AGENT_TOOLS, helperTools, toolRule, toolTier } from "./tools.ts";

describe("SkillLedger", () => {
  let root: string;
  let ledger: SkillLedger;

  beforeEach(() => {
    root = join(tmpdir(), `pp-skill-ledger-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
    ledger = new SkillLedger(root);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test("records mutations with SHA-256 blobs and rolls back patch, archive, and create", () => {
    const file = ledger.skillFile("invoice-check");
    mkdirSync(ledger.skillDir("invoice-check"), { recursive: true });
    const v1 = "---\nname: invoice-check\ndescription: Check invoices\n---\n\nStep 1: open PDF.\n";
    writeFileSync(file, v1, "utf8");
    const created = ledger.recordMutation({
      actor: "agent",
      action: "create",
      skill: "invoice-check",
      beforeContent: null,
      afterContent: v1,
      summary: "Initial version",
    });

    const v2 =
      "---\nname: invoice-check\ndescription: Check invoices\n---\n\nStep 1: open PDF.\nStep 2: verify VAT.\n";
    writeFileSync(file, v2, "utf8");
    const patched = ledger.recordMutation({
      actor: "agent",
      action: "patch",
      skill: "invoice-check",
      beforeContent: v1,
      afterContent: v2,
      summary: "Added VAT step",
    });

    expect(ledger.list("invoice-check").map((e) => e.id)).toEqual([patched.id, created.id]);

    // Roll back the patch -> restores v1.
    const undonePatch = ledger.rollback(patched.id);
    expect(undonePatch.restored).toBe("content");
    expect(readFileSync(file, "utf8")).toBe(v1);

    // Roll back the create -> archives the skill instead of deleting permanently.
    const undoneCreate = ledger.rollback(created.id);
    expect(undoneCreate.restored).toBe("archived");
    expect(existsSync(file)).toBe(false);
    expect(existsSync(ledger.archiveDir)).toBe(true);
  });

  test("fails closed on rollback when the backup blob is missing", () => {
    const file = ledger.skillFile("report-gen");
    mkdirSync(ledger.skillDir("report-gen"), { recursive: true });
    const v1 = "---\nname: report-gen\ndescription: Reports\n---\n\nv1\n";
    const v2 = "---\nname: report-gen\ndescription: Reports\n---\n\nv2\n";
    writeFileSync(file, v2, "utf8");
    const entry = ledger.recordMutation({
      actor: "agent",
      action: "patch",
      skill: "report-gen",
      beforeContent: v1,
      afterContent: v2,
      summary: "Update",
    });
    unlinkSync(join(ledger.blobsDir, `${entry.beforeHash}.md`));
    expect(() => ledger.rollback(entry.id)).toThrow(/backup blob.*missing/i);
    expect(readFileSync(file, "utf8")).toBe(v2);
  });

  test("rejects invalid skill names and symlinked skill folders", () => {
    expect(() => ledger.skillDir("../escape")).toThrow(/Invalid skill name/);
    const outside = join(tmpdir(), `pp-outside-${Date.now()}`);
    mkdirSync(outside, { recursive: true });
    try {
      symlinkSync(outside, join(root, "linked-skill"));
      expect(() => ledger.skillDir("linked-skill")).toThrow(/Refused symlink/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("skill_manage tool", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = join(tmpdir(), `pp-skill-tool-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });
  });

  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  const textOf = (res: { content: ({ type: string; text?: string } | unknown)[] }) =>
    res.content
      .map((part) =>
        typeof part === "object" && part !== null && "text" in part ? String(part.text) : "",
      )
      .join("");

  test("registers as write tier globally, uses per-action tiers, and is excluded from read-only helpers", () => {
    const settings = { toolPolicies: {}, shellEnabled: false } as unknown as AppSettings;
    expect(AGENT_TOOLS).toContain(SKILL_MANAGE_TOOL);
    expect(toolTier(SKILL_MANAGE_TOOL)).toBe("write");
    expect(toolRule(SKILL_MANAGE_TOOL, "write", settings).effective).toBe("ask");
    expect(helperTools(settings, null)).not.toContain(SKILL_MANAGE_TOOL);

    expect(skillManageActionTier("list")).toBe("read");
    expect(skillManageActionTier("read")).toBe("read");
    expect(skillManageActionTier("history")).toBe("read");
    expect(skillManageActionTier("create")).toBe("write");
    expect(skillManageActionTier("patch")).toBe("write");
    expect(skillManageActionTier("archive")).toBe("write");
    expect(skillManageActionTier("rollback")).toBe("write");
  });

  test("enforces read-before-write guard, secret blocking, single-match patch, archive, and rollback", async () => {
    const onMutated = vi.fn();
    const run = async (
      tool: ReturnType<typeof createSkillManageTool>,
      params: Record<string, unknown>,
    ) =>
      textOf(await tool.execute("call", params as never, undefined, undefined, undefined as never));

    // Seed an existing skill on disk (simulating a skill created in a previous session).
    const existingDir = join(cwd, ".agents", "skills", "monthly-close");
    mkdirSync(existingDir, { recursive: true });
    const initial =
      "---\nname: monthly-close\ndescription: Monthly close checklist\n---\n\n1. Export ledger.\n2. Reconcile bank.\n";
    writeFileSync(join(existingDir, "SKILL.md"), initial, "utf8");

    const tool = createSkillManageTool({ cwd, onMutated });

    // List sees existing skill.
    expect(await run(tool, { action: "list" })).toContain("monthly-close");

    // Patching BEFORE reading in this session is blocked by read-before-write guard.
    await expect(
      run(tool, {
        action: "patch",
        name: "monthly-close",
        oldText: "2. Reconcile bank.",
        newText: "2. Reconcile bank and petty cash.",
      }),
    ).rejects.toThrow(/Read-before-write guard/);

    // Reading marks the skill as read.
    expect(await run(tool, { action: "read", name: "monthly-close" })).toContain("Export ledger");

    // Patch with raw secret is refused.
    await expect(
      run(tool, {
        action: "patch",
        name: "monthly-close",
        oldText: "2. Reconcile bank.",
        newText: "2. Use key sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456.",
      }),
    ).rejects.toThrow(/secret|API key/i);

    // Valid patch succeeds and records a ledger entry.
    const patchMsg = await run(tool, {
      action: "patch",
      name: "monthly-close",
      oldText: "2. Reconcile bank.",
      newText: "2. Reconcile bank and petty cash.",
      summary: "Include petty cash",
    });
    expect(patchMsg).toContain("Patched skill");
    const entryId = /ledger entry: ([a-z0-9-]+)/i.exec(patchMsg)?.[1];
    expect(entryId).toBeTruthy();
    expect(onMutated).toHaveBeenCalledTimes(1);

    // History lists the entry.
    expect(await run(tool, { action: "history", name: "monthly-close" })).toContain(
      "Include petty cash",
    );

    // Rollback restores original text.
    await run(tool, { action: "rollback", entryId: entryId! });
    expect(readFileSync(join(existingDir, "SKILL.md"), "utf8")).toBe(initial);

    // Create a brand new skill, then archive and restore it via rollback.
    const createMsg = await run(tool, {
      action: "create",
      name: "vendor-audit",
      description: "Audit vendor invoices\u200b",
      body: "Check tax ID and bank account.",
    });
    expect(createMsg).toContain('Created skill "vendor-audit"');
    expect(
      readFileSync(join(cwd, ".agents", "skills", "vendor-audit", "SKILL.md"), "utf8"),
    ).not.toContain("\u200b");

    const archiveMsg = await run(tool, { action: "archive", name: "vendor-audit" });
    const archiveId = /ledger entry: ([a-z0-9-]+)/i.exec(archiveMsg)?.[1];
    expect(existsSync(join(cwd, ".agents", "skills", "vendor-audit", "SKILL.md"))).toBe(false);

    await run(tool, { action: "rollback", entryId: archiveId! });
    expect(existsSync(join(cwd, ".agents", "skills", "vendor-audit", "SKILL.md"))).toBe(true);
  });

  test("describeSkillManageCall renders clear approval card titles and patch diffs", () => {
    const patch = describeSkillManageCall({
      action: "patch",
      name: "monthly-close",
      oldText: "old line",
      newText: "new line",
    });
    expect(patch.title).toBe('Update skill "monthly-close"');
    expect(patch.detail).toContain("- old line");
    expect(patch.detail).toContain("+ new line");

    const create = describeSkillManageCall({
      action: "create",
      name: "vendor-audit",
      description: "Audit vendors",
      body: "Steps here",
    });
    expect(create.title).toBe('Create skill "vendor-audit"');
    expect(create.detail).toContain("Audit vendors");
  });
});
