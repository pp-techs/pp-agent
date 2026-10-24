/**
 * Skills that ship with the app (`resources/skills/<name>/`). They are copied into the user's skill
 * folder so Pi loads them like any other skill, and the Skills page marks them as built in.
 *
 * Nothing the person did is overwritten. `builtin-skills.json` remembers the content hash each
 * copy had when it was written: a copy still matching it is replaced when the app ships a newer
 * version; an edited copy, a skill of the same name the person made, and a built-in skill the
 * person deleted are left alone. A skill the app no longer ships is removed again when its copy is
 * still unmodified.
 */
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Manifest = Record<string, string>;

async function hashFolder(root: string): Promise<string> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.slice(root.length));
    hash.update(await readFile(file));
  }
  return hash.digest("hex");
}

async function readManifest(file: string): Promise<Manifest> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

/** Returns the names of the built-in skills that are installed and unmodified. */
export async function seedBuiltInSkills(
  sourceDir: string | null,
  skillsDir: string,
  manifestFile: string,
): Promise<Set<string>> {
  const manifest = await readManifest(manifestFile);
  const names = sourceDir
    ? (await readdir(sourceDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : [];
  const unmodified = new Set<string>();
  let changed = false;

  for (const name of names) {
    const source = join(sourceDir ?? "", name);
    const target = join(skillsDir, name);
    const bundled = await hashFolder(source);
    const installed = await hashFolder(target).catch(() => null);
    const remembered = manifest[name];

    if (installed === null) {
      // Seeded before and gone now: the person deleted it.
      if (remembered !== undefined) continue;
    } else if (remembered === undefined || installed !== remembered) {
      // Not ours, or edited: leave it.
      continue;
    }
    if (installed !== bundled) {
      await rm(target, { recursive: true, force: true });
      await mkdir(skillsDir, { recursive: true });
      await cp(source, target, { recursive: true });
    }
    if (remembered !== bundled) {
      manifest[name] = bundled;
      changed = true;
    }
    unmodified.add(name);
  }

  for (const [name, remembered] of Object.entries(manifest)) {
    if (names.includes(name)) continue;
    const target = join(skillsDir, name);
    const installed = await hashFolder(target).catch(() => null);
    if (installed === remembered) await rm(target, { recursive: true, force: true });
    delete manifest[name];
    changed = true;
  }

  if (changed) await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
  return unmodified;
}
