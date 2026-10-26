import { mkdtemp, readlink, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import { acquireEndpointLock } from "./endpoint-lock.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pp-lock-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it("reclaims a dead process lock without letting competing claimants remove the winner", async () => {
  const path = join(dir, "endpoint.lock");
  await symlink(`2147483647-${"a".repeat(32)}`, path);
  const releases = await Promise.all(Array.from({ length: 20 }, () => acquireEndpointLock(path)));
  expect(releases.filter(Boolean)).toHaveLength(1);
  expect(await readlink(path)).toMatch(new RegExp(`^${process.pid}-`));
  await releases.find(Boolean)!();
  const release = await acquireEndpointLock(path);
  expect(release).not.toBeNull();
  await release!();
});

it("does not reclaim a live process's lock", async () => {
  const path = join(dir, "endpoint.lock");
  const owner = `${process.pid}-${"b".repeat(32)}`;
  await symlink(owner, path);
  expect(await acquireEndpointLock(path)).toBeNull();
  expect(await readlink(path)).toBe(owner);
});
