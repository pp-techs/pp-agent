import { randomBytes } from "node:crypto";
import { readlink, symlink, unlink } from "node:fs/promises";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM is a live process we cannot signal. Only ESRCH proves it is gone.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function owner(path: string): Promise<string | null> {
  try {
    return await readlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Atomically publishes the PID and unique generation, with no empty-lock crash window. */
export async function acquireEndpointLock(path: string): Promise<(() => Promise<void>) | null> {
  const mine = `${process.pid}-${randomBytes(16).toString("hex")}`;
  for (;;) {
    try {
      await symlink(mine, path);
      return async () => {
        if ((await owner(path)) === mine) await unlink(path);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const previous = await owner(path);
    if (previous === null) continue;
    const match = /^(\d+)-[0-9a-f]{32}$/.exec(previous);
    if (!match) throw new Error(`Invalid endpoint lock: ${path}`);
    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Invalid lock PID: ${path}`);
    if (alive(pid)) return null;

    // Serialize reclaimers of THIS generation so a delayed contender cannot unlink a new lock.
    // A reclaimer that itself crashed is recovered by the same PID check.
    const release = await acquireEndpointLock(`${path}.${previous}.reap`);
    if (!release) return null;
    try {
      if ((await owner(path)) === previous) await unlink(path);
    } finally {
      await release();
    }
  }
}
