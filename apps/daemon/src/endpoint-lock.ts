import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, readlink, symlink, unlink } from "node:fs/promises";
import { promisify } from "node:util";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
let boot: Promise<string> | undefined;

async function bootIdentifier(): Promise<string> {
  const value =
    process.platform === "darwin"
      ? (await promisify(execFile)("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"])).stdout
      : await readFile("/proc/sys/kernel/random/boot_id", "utf8");
  const id = value.trim().toLowerCase();
  if (!new RegExp(`^${UUID}$`).test(id)) throw new Error("Invalid system boot identifier.");
  return id;
}

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

/** Atomically publishes the PID, unique generation and boot, with no empty-lock crash window. */
export async function acquireEndpointLock(path: string): Promise<(() => Promise<void>) | null> {
  const bootId = await (boot ??= bootIdentifier());
  const mine = `${process.pid}-${randomBytes(16).toString("hex")}-${bootId}`;
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
    const match = new RegExp(`^(\\d+)-[0-9a-f]{32}(?:-(${UUID}))?$`).exec(previous);
    if (!match) throw new Error(`Invalid endpoint lock: ${path}`);
    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Invalid lock PID: ${path}`);
    // Legacy locks have no boot ID, so conservatively retain their PID liveness check.
    if ((match[2] === undefined || match[2] === bootId) && alive(pid)) return null;

    // Serialize reclaimers of THIS generation so a delayed contender cannot unlink a new lock.
    // A reclaimer that itself crashed is recovered by the same boot and PID checks.
    const release = await acquireEndpointLock(`${path}.${previous}.reap`);
    if (!release) return null;
    try {
      if ((await owner(path)) === previous) await unlink(path);
    } finally {
      await release();
    }
  }
}
