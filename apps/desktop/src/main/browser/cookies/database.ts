import { spawn } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** A browser keeps its cookie database locked while it runs (Windows), so copying it fails. */
export class LockedError extends Error {}

function isLocked(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EBUSY" || code === "EPERM" || code === "EACCES";
}

/**
 * Reads a copy of a browser's SQLite database, never the original: the browser may be writing it,
 * and opening it could take the browser's lock. The write-ahead log and rollback journal come
 * along, or the newest cookies would be missing.
 */
export async function readDatabaseCopy<T>(file: string, read: (db: DatabaseSync) => T): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "pp-agent-cookies-"));
  try {
    const copy = join(dir, basename(file));
    try {
      await copyFile(file, copy);
    } catch (error) {
      throw isLocked(error) ? new LockedError((error as Error).message) : error;
    }
    for (const suffix of ["-wal", "-journal"]) {
      await copyFile(`${file}${suffix}`, `${copy}${suffix}`).catch(() => {});
    }
    const db = new DatabaseSync(copy);
    try {
      return read(db);
    } finally {
      db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Runs a program to completion and returns its standard output; `input` goes to its stdin. */
export function run(command: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
    child.stdin.end(input ?? "");
  });
}
