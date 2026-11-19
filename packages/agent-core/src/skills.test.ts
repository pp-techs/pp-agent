import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { listWorkspaceSkills, skillsFingerprint, workspaceSkillsDir } from "./skills.ts";

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
  });
});

describe("skillsFingerprint", () => {
  test("changes when a skill is added or its SKILL.md is rewritten, not for other files", async () => {
    const dir = workspaceSkillsDir(cwd);
    const empty = await skillsFingerprint([dir]);
    const folder = await skill("weather", "Forecast");
    const added = await skillsFingerprint([dir]);
    expect(added).not.toBe(empty);

    await writeFile(join(folder, "notes.txt"), "x");
    expect(await skillsFingerprint([dir])).toBe(added);

    await writeFile(
      join(folder, "SKILL.md"),
      "---\nname: weather\ndescription: Updated text\n---\n",
    );
    expect(await skillsFingerprint([dir])).not.toBe(added);
  });
});
