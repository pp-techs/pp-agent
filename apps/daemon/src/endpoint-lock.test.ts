import { mkdtemp, readlink, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { acquireEndpointLock } from "./endpoint-lock.ts";

let dir: string;
let currentOwner: string;
describe.skipIf(process.platform === "win32")("Unix endpoint lock", () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pp-lock-"));
    const path = join(dir, "sample.lock");
    const release = await acquireEndpointLock(path);
    currentOwner = await readlink(path);
    await release!();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.each(["current", "previous", "legacy"])(
    "reclaims a dead process lock from %s boot without letting competing claimants remove the winner",
    async (source) => {
      const path = join(dir, "endpoint.lock");
      let owner = currentOwner.replace(/^\d+/, "2147483647");
      if (source === "previous") owner = owner.slice(0, -1) + (owner.endsWith("0") ? "1" : "0");
      if (source === "legacy") owner = owner.slice(0, -37);
      await symlink(owner, path);
      const releases = await Promise.all(
        Array.from({ length: 20 }, () => acquireEndpointLock(path)),
      );
      expect(releases.filter(Boolean)).toHaveLength(1);
      expect(await readlink(path)).toMatch(new RegExp(`^${process.pid}-`));
      await releases.find(Boolean)!();
      const release = await acquireEndpointLock(path);
      expect(release).not.toBeNull();
      await release!();
    },
  );

  it("does not reclaim a live process's lock", async () => {
    const path = join(dir, "endpoint.lock");
    const owner = currentOwner;
    await symlink(owner, path);
    expect(await acquireEndpointLock(path)).toBeNull();
    expect(await readlink(path)).toBe(owner);
  });

  it("reclaims a previous boot's lock even when its PID is alive on this boot", async () => {
    const path = join(dir, "endpoint.lock");
    const owner = currentOwner.slice(0, -1) + (currentOwner.endsWith("0") ? "1" : "0");
    await symlink(owner, path);
    const kill = vi.spyOn(process, "kill");
    try {
      const release = await acquireEndpointLock(path);
      expect(release).not.toBeNull();
      expect(kill).not.toHaveBeenCalled();
      expect(await readlink(path)).not.toBe(owner);
      await release!();
    } finally {
      kill.mockRestore();
    }
  });

  it("retains a live legacy lock with no boot identifier", async () => {
    const path = join(dir, "endpoint.lock");
    const owner = currentOwner.slice(0, -37);
    await symlink(owner, path);
    expect(await acquireEndpointLock(path)).toBeNull();
    expect(await readlink(path)).toBe(owner);
  });
});
