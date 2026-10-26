import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

function isInside(root: string, path: string): boolean {
  const inside = relative(root, path);
  return (
    inside === "" || (inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))
  );
}

/** `realpath` of the nearest ancestor that exists, followed by the not-yet-created remainder. */
async function realpathOfExistingPart(path: string): Promise<string> {
  const missing: string[] = [];
  let current = path;
  for (;;) {
    try {
      return resolve(await realpath(current), ...missing);
    } catch (error) {
      const parent = dirname(current);
      if (parent === current || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missing.unshift(basename(current));
      current = parent;
    }
  }
}

/**
 * Resolves `path` against the workspace and refuses anything outside it, including through
 * symbolic links. The file need not exist yet. Returns the absolute path and the
 * workspace-relative form shown to the user.
 */
export async function resolveInWorkspace(
  workspaceDir: string,
  path: string,
): Promise<{ absolute: string; display: string }> {
  if (path.trim() === "" || path.includes("\0")) throw new Error("The file path is empty.");
  const root = resolve(workspaceDir);
  const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path);
  const outside = `${path} is outside the workspace folder. Office tools only work with files inside it.`;
  if (!isInside(root, absolute)) throw new Error(outside);
  if (!isInside(await realpath(root), await realpathOfExistingPart(absolute)))
    throw new Error(outside);
  return { absolute, display: relative(root, absolute).split(sep).join("/") };
}
