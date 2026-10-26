import { createHmac, timingSafeEqual } from "node:crypto";
import { lstat } from "node:fs/promises";
import { dirname } from "node:path";

export const validNonce = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

export function proof(
  token: string,
  role: "client" | "daemon",
  ...fields: (string | number)[]
): string {
  return createHmac("sha256", token)
    .update(JSON.stringify([role, ...fields]))
    .digest("hex");
}

export function verifyProof(given: unknown, expected: string): boolean {
  return (
    validNonce(given) && timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"))
  );
}

export async function validateSocketDirectory(dir: string): Promise<void> {
  const stats = await lstat(dir);
  if (!stats.isDirectory() || stats.uid !== process.getuid?.() || (stats.mode & 0o022) !== 0)
    throw new Error(
      `${dir} must be a directory owned by the current user and not writable by other users.`,
    );
}

/** Reject symlinks, foreign owners and sockets accessible to other users before connecting. */
export async function validateUnixEndpoint(endpoint: string): Promise<void> {
  await validateSocketDirectory(dirname(endpoint));
  const stats = await lstat(endpoint);
  if (!stats.isSocket() || stats.uid !== process.getuid?.() || (stats.mode & 0o077) !== 0)
    throw new Error(`${endpoint} must be a socket accessible only to its owner.`);
}
