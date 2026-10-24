import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { seedBuiltInSkills } from "./skills-builtin.ts";

let root: string;
const source = () => join(root, "bundled");
const skills = () => join(root, "skills");
const manifest = () => join(root, "manifest.json");

async function skill(dir: string, name: string, body: string) {
  await mkdir(join(dir, name), { recursive: true });
  await writeFile(join(dir, name, "SKILL.md"), body);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "builtin-skills-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("seedBuiltInSkills", () => {
  test("removes an unmodified copy the app no longer ships, keeps an edited one", async () => {
    await skill(source(), "kept", "v1");
    await skill(source(), "dropped", "v1");
    await skill(source(), "dropped-edited", "v1");
    await seedBuiltInSkills(source(), skills(), manifest());
    await writeFile(join(skills(), "dropped-edited", "SKILL.md"), "mine");

    await rm(join(source(), "dropped"), { recursive: true });
    await rm(join(source(), "dropped-edited"), { recursive: true });
    const builtIn = await seedBuiltInSkills(source(), skills(), manifest());

    expect([...builtIn]).toEqual(["kept"]);
    expect(existsSync(join(skills(), "dropped"))).toBe(false);
    expect(await readFile(join(skills(), "dropped-edited", "SKILL.md"), "utf8")).toBe("mine");
    expect(Object.keys(JSON.parse(await readFile(manifest(), "utf8")))).toEqual(["kept"]);
  });

  test("never touches a skill the person made", async () => {
    await skill(source(), "kept", "v1");
    await skill(skills(), "mine", "own");
    await seedBuiltInSkills(source(), skills(), manifest());
    expect(await readFile(join(skills(), "mine", "SKILL.md"), "utf8")).toBe("own");
  });
});
