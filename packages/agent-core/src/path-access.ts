import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isInside, realpathOfExistingPart } from "./office/files.ts";

/**
 * Read-tier tools that open files by path, the argument holding it, and how they read:
 * `pi` tools resolve the path the way pi does (`~`, a leading `@`, `file://`), `recursive` tools
 * read below the folder they are given.
 */
const PATH_TOOLS: Record<string, { pi: boolean; recursive: boolean }> = {
  read: { pi: true, recursive: false },
  ls: { pi: true, recursive: false },
  find: { pi: true, recursive: true },
  grep: { pi: true, recursive: true },
  read_document: { pi: false, recursive: false },
};

/** Where a read-tier file tool reaches: the workspace (or installed skills), elsewhere, or a folder never read. */
export type PathAccess = "inside" | "outside" | "denied";

export interface PathRules {
  /** Folders read freely even inside a denied one: the installed skills. */
  trusted: readonly string[];
  /** Folders never read, whatever the policy or yolo mode: the app's own data and SSH keys. */
  denied: readonly string[];
}

/** The folders no file tool may read: the app's data folder (vault, keys, tokens, sessions) and `~/.ssh`. */
export function deniedFolders(appHome: string): string[] {
  return [appHome, join(homedir(), ".ssh")];
}

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/** `/c/Users` and `/mnt/c/Users` (Git Bash, WSL) → `C:\Users`, as pi reads them on Windows. */
function windowsShellPath(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return path;
  const match = /^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i.exec(path);
  if (!match) return path;
  return `${match[1]!.toUpperCase()}:\\${match[2]?.replaceAll("/", "\\") ?? ""}`;
}

/** The absolute path pi's file tools open for `path` (see `resolveToCwd` in pi's path-utils). */
function piPath(path: string, cwd: string): string {
  let normalized = path.replace(UNICODE_SPACES, " ");
  if (normalized.startsWith("@")) normalized = normalized.slice(1);
  if (process.platform === "win32") normalized = windowsShellPath(normalized);
  if (normalized === "~") normalized = homedir();
  else if (
    normalized.startsWith("~/") ||
    (process.platform === "win32" && normalized.startsWith("~\\"))
  )
    normalized = join(homedir(), normalized.slice(2));
  else if (normalized.startsWith("file://")) normalized = fileURLToPath(normalized);
  return isAbsolute(normalized) ? resolve(normalized) : resolve(cwd, normalized);
}

/** `realpath` of `path` where it exists; the path as written when it cannot be resolved. */
async function real(path: string): Promise<string> {
  try {
    return await realpathOfExistingPart(path);
  } catch {
    return path;
  }
}

/**
 * Where a call of a read-tier file tool reaches, with symbolic links followed; null when `toolName`
 * does not read files by path. A folder searched recursively that holds a denied folder is denied
 * too, so a search of the home folder cannot read the app's keys.
 */
export async function pathAccess(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
  rules: PathRules,
): Promise<{ access: PathAccess; path: string } | null> {
  const tool = Object.hasOwn(PATH_TOOLS, toolName) ? PATH_TOOLS[toolName] : undefined;
  if (!tool) return null;
  const raw = typeof input.path === "string" && input.path.trim() !== "" ? input.path : ".";
  if (raw.includes("\0")) return { access: "denied", path: raw };
  const absolute = tool.pi ? piPath(raw, cwd) : isAbsolute(raw) ? resolve(raw) : resolve(cwd, raw);
  const target = await real(absolute);
  const [trusted, denied, workspace] = await Promise.all([
    Promise.all(rules.trusted.map((root) => real(resolve(root)))),
    Promise.all(rules.denied.map((root) => real(resolve(root)))),
    real(resolve(cwd)),
  ]);
  if (trusted.some((root) => isInside(root, target))) return { access: "inside", path: absolute };
  if (denied.some((root) => isInside(root, target) || (tool.recursive && isInside(target, root))))
    return { access: "denied", path: absolute };
  return { access: isInside(workspace, target) ? "inside" : "outside", path: absolute };
}
