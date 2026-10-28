/**
 * A workspace's rules live in `AGENTS.md` in its folder, like in other coding agents. Pi loads
 * that file (and the ones in the folders above it) into the system prompt; this module reads and
 * writes the folder's own file for Settings › Workspaces and moves the `instructions` that older
 * settings files kept per workspace into it.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { loadProjectContextFiles } from "@earendil-works/pi-coding-agent";
import type { WorkspaceInstructions } from "@workspace/shared";
import type { LegacyInstructions } from "./workspaces.ts";

const FILE = "AGENTS.md";
/** Pi gives this file precedence over AGENTS.md in the same folder. */
const OVERRIDE_FILE = "AGENTS.override.md";

/** The folder's AGENTS.md, plus the context files Pi also loads for a conversation there. */
export async function readWorkspaceInstructions(
  folder: string,
  agentDir: string,
): Promise<WorkspaceInstructions> {
  const path = join(folder, FILE);
  const content = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "EISDIR") return null;
    throw error;
  });
  const own = resolve(folder);
  return {
    path,
    content: content ?? "",
    exists: content !== null,
    overridden: existsSync(join(folder, OVERRIDE_FILE)),
    inherited: loadProjectContextFiles({ cwd: own, agentDir })
      .map((file) => file.path)
      .filter((file) => dirname(file) !== own),
  };
}

/** Replaces the folder's AGENTS.md, creating the folder and the file when missing. */
export async function saveWorkspaceInstructions(folder: string, content: string): Promise<void> {
  await mkdir(folder, { recursive: true });
  const path = join(folder, FILE);
  const temp = `${path}.tmp`;
  await writeFile(temp, content);
  await rename(temp, path);
}

function writeFileSyncAtomic(path: string, content: string): void {
  const temp = `${path}.tmp`;
  writeFileSync(temp, content);
  renameSync(temp, path);
}

/**
 * Moves instructions saved in settings.json into each workspace folder's AGENTS.md: a new file
 * when there is none, otherwise a section appended to the existing one. Safe to run again (text
 * already in the file is not added twice). When a folder cannot be written, the text is kept in
 * `backupDir` so it is never lost.
 */
export function migrateWorkspaceInstructions(
  entries: readonly LegacyInstructions[],
  defaultFolder: string,
  backupDir: string,
): void {
  for (const { id, dir, instructions } of entries) {
    const folder = dir ?? defaultFolder;
    try {
      mkdirSync(folder, { recursive: true });
      const path = join(folder, FILE);
      const existing = existsSync(path) ? readFileSync(path, "utf8") : null;
      if (existing === null) writeFileSyncAtomic(path, `${instructions}\n`);
      else if (!existing.includes(instructions))
        writeFileSyncAtomic(
          path,
          `${existing.trimEnd()}\n\n## Workspace instructions\n\n${instructions}\n`,
        );
    } catch (error) {
      const backup = join(backupDir, `workspace-instructions-${id}.md`);
      console.error(
        `Instructions of workspace ${id} could not move to ${folder}; see ${backup}.`,
        error,
      );
      try {
        writeFileSync(backup, `${instructions}\n`);
      } catch {
        // Nothing more can be done; the error above names the workspace.
      }
    }
  }
}
