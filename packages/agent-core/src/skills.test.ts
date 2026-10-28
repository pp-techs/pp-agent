import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { isWorkspaceSkill, listWorkspaceSkills, workspaceSkillsDir } from "./skills.ts";

let cwd: string;

async function skill(name: string, description: string) {
  const dir = join(workspaceSkillsDir(cwd), name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nDo it.\n`,
  );
  return dir;
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "workspace-skills-"));
});
afterEach(() => rm(cwd, { recursive: true, force: true }));

describe("workspace skills", () => {
  test("lists the skills in .agents/skills, sorted, with their enabled state", async () => {
    await skill("zeta", "Last");
    await skill("alpha", "First");
    await mkdir(join(workspaceSkillsDir(cwd), "not-a-skill"));

    const skills = await listWorkspaceSkills(cwd, ["zeta"]);

    expect(
      skills.map(({ name, description, enabled, builtIn }) => ({
        name,
        description,
        enabled,
        builtIn,
      })),
    ).toEqual([
      { name: "alpha", description: "First", enabled: true, builtIn: false },
      { name: "zeta", description: "Last", enabled: false, builtIn: false },
    ]);
  });

  test("finds none when the folder has no .agents/skills", async () => {
    expect(await listWorkspaceSkills(cwd, [])).toEqual([]);
    expect(isWorkspaceSkill(cwd, join(cwd, "anything"))).toBe(false);
  });

  test("owns only skills inside the workspace's .agents/skills", async () => {
    const dir = await skill("alpha", "First");

    expect(isWorkspaceSkill(cwd, dir)).toBe(true);
    expect(isWorkspaceSkill(cwd, workspaceSkillsDir(cwd))).toBe(false);
    expect(isWorkspaceSkill(cwd, join(cwd, ".agents", "other", "alpha"))).toBe(false);
    expect(isWorkspaceSkill(cwd, join(tmpdir(), "elsewhere"))).toBe(false);
  });
});
