import { chmod, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vite-plus/test";
import { proof, validateUnixEndpoint, verifyProof } from "./auth.ts";

let dir: string;
let server: Server;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (dir) await rm(dir, { recursive: true, force: true });
});

it("binds proofs to role, both nonces, and authenticated metadata", () => {
  const expected = proof("secret", "daemon", "server nonce", "client nonce", 2, "1.0", 123);
  expect(verifyProof(expected, expected)).toBe(true);
  expect(
    verifyProof(proof("secret", "client", "server nonce", "client nonce", 2, "1.0", 123), expected),
  ).toBe(false);
  expect(
    verifyProof(
      proof("secret", "daemon", "server nonce", "another nonce", 2, "1.0", 123),
      expected,
    ),
  ).toBe(false);
  expect(
    verifyProof(proof("secret", "daemon", "server nonce", "client nonce", 2, "1.0", 456), expected),
  ).toBe(false);
  expect(verifyProof("bad", expected)).toBe(false);
});

it.skipIf(process.platform === "win32")(
  "rejects unsafe Unix socket paths before connecting",
  async () => {
    dir = await mkdtemp(join(tmpdir(), "pp-auth-"));
    const socket = join(dir, "socket");
    server = createServer();
    await new Promise<void>((resolve) => server.listen(socket, resolve));
    await chmod(socket, 0o600);
    await expect(validateUnixEndpoint(socket)).resolves.toBeUndefined();
    await chmod(socket, 0o666);
    await expect(validateUnixEndpoint(socket)).rejects.toThrow(/only to its owner/);
    await chmod(socket, 0o600);
    await chmod(dir, 0o777);
    await expect(validateUnixEndpoint(socket)).rejects.toThrow(/not writable/);
    await chmod(dir, 0o700);
    await symlink(socket, join(dir, "link"));
    await expect(validateUnixEndpoint(join(dir, "link"))).rejects.toThrow(/socket/);
    await mkdir(join(dir, "nested"));
    await symlink(dir, join(dir, "nested", "parent"));
    await expect(validateUnixEndpoint(join(dir, "nested", "parent", "socket"))).rejects.toThrow(
      /directory/,
    );
  },
);
