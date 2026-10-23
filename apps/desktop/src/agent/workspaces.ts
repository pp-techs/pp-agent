/**
 * Workspaces: a folder plus the defaults and rules for conversations started in it. Stored in
 * settings.json (`SettingsFile.workspaces`); this module validates them and makes ids. A
 * conversation belongs to the workspace whose folder is its working directory (`cwd`), so a
 * workspace's folder is fixed once it is created.
 */
import { mkdir, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  type AgentProfile,
  DEFAULT_WORKSPACE_ID,
  type SaveWorkspaceInput,
  THINKING_LEVELS,
  type ThinkingLevel,
  type WorkspaceProfile,
  type WorkspaceSummary,
} from "@workspace/shared";
import { modelRef } from "./agents.ts";

const MAX_NAME_LENGTH = 60;
const MAX_ICON_LENGTH = 8;
const MAX_INSTRUCTIONS_LENGTH = 20_000;
const DEFAULT_ICON = "📁";
const ID_PREFIX = "ws-";

export const DEFAULT_WORKSPACE: WorkspaceProfile = {
  id: DEFAULT_WORKSPACE_ID,
  name: "Personal",
  icon: DEFAULT_ICON,
  dir: null,
  instructions: "",
  agentId: null,
  model: null,
  thinkingLevel: null,
};

/** Workspace fields a person edits (everything but id and folder). */
type EditableFields = Omit<WorkspaceProfile, "id" | "dir">;

type Loose = Partial<Record<keyof WorkspaceProfile, unknown>>;

export function summarizeWorkspace(workspace: WorkspaceProfile): WorkspaceSummary {
  return { id: workspace.id, name: workspace.name, icon: workspace.icon };
}

/** Default workspace first, then by name. */
export function sortWorkspaces(workspaces: readonly WorkspaceProfile[]): WorkspaceProfile[] {
  return [...workspaces].sort(
    (a, b) =>
      Number(b.id === DEFAULT_WORKSPACE_ID) - Number(a.id === DEFAULT_WORKSPACE_ID) ||
      a.name.localeCompare(b.name),
  );
}

/** The workspace with `id`, or the default workspace when it no longer exists. */
export function findWorkspace(
  workspaces: readonly WorkspaceProfile[],
  id: string | null,
): WorkspaceProfile {
  return (
    workspaces.find((workspace) => workspace.id === id) ??
    workspaces.find((workspace) => workspace.id === DEFAULT_WORKSPACE_ID) ??
    structuredClone(DEFAULT_WORKSPACE)
  );
}

/** The folder of `workspace`; the default workspace uses the app's folder. */
export function workspaceFolder(workspace: WorkspaceProfile, defaultDir: string): string {
  return workspace.dir ?? defaultDir;
}

/** The workspace a conversation that ran in `cwd` belongs to; the default one when none match. */
export function workspaceForCwd(
  workspaces: readonly WorkspaceProfile[],
  cwd: string,
  defaultDir: string,
): WorkspaceProfile {
  const target = resolve(cwd);
  return (
    workspaces.find((workspace) => resolve(workspaceFolder(workspace, defaultDir)) === target) ??
    findWorkspace(workspaces, DEFAULT_WORKSPACE_ID)
  );
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function thinkingLevel(value: unknown): ThinkingLevel | null {
  return THINKING_LEVELS.includes(value as ThinkingLevel) ? (value as ThinkingLevel) : null;
}

/**
 * The editable fields from untrusted input. `strict` throws plain-English errors for values a
 * person typed; otherwise values that do not fit are shortened or dropped.
 */
function editableFields(value: Loose, strict: boolean): EditableFields {
  const name = text(value.name);
  if (!name) throw new Error("Enter a name for the workspace.");
  if (strict && name.length > MAX_NAME_LENGTH)
    throw new Error(`The name can be at most ${MAX_NAME_LENGTH} characters.`);
  const icon = text(value.icon);
  if (strict && icon.length > MAX_ICON_LENGTH) throw new Error("Use a single emoji as the icon.");
  const instructions = text(value.instructions);
  if (strict && instructions.length > MAX_INSTRUCTIONS_LENGTH)
    throw new Error(`The instructions can be at most ${MAX_INSTRUCTIONS_LENGTH} characters.`);
  const agentId = text(value.agentId);
  return {
    name: name.slice(0, MAX_NAME_LENGTH),
    icon: icon && icon.length <= MAX_ICON_LENGTH ? icon : DEFAULT_ICON,
    instructions: instructions.slice(0, MAX_INSTRUCTIONS_LENGTH),
    agentId: agentId || null,
    model: modelRef(value.model),
    thinkingLevel: thinkingLevel(value.thinkingLevel),
  };
}

/** Validated fields of a workspace being saved; throws a message for the person otherwise. */
export function validateWorkspaceInput(input: SaveWorkspaceInput): EditableFields {
  return editableFields(input as Loose, true);
}

function asLoose(value: unknown): Loose | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Loose)
    : null;
}

/**
 * Workspaces read from settings.json. Entries that do not fit are dropped one by one, duplicate ids
 * and folders keep the first, an agent that no longer exists is forgotten, and the default
 * workspace is added when missing. Without a `workspaces` list (a file from before workspaces),
 * every folder an agent used becomes a workspace that starts with that agent.
 */
export function readWorkspaces(
  raw: unknown,
  agents: readonly AgentProfile[],
  rawAgents: unknown,
): WorkspaceProfile[] {
  const entries = Array.isArray(raw) ? raw : legacyEntries(agents, rawAgents);
  const workspaces: WorkspaceProfile[] = [];
  const ids = new Set<string>();
  const dirs = new Set<string>();
  for (const entry of entries) {
    const value = asLoose(entry);
    const id = typeof value?.id === "string" ? value.id : "";
    if (!value || !id || ids.has(id)) continue;
    const isDefault = id === DEFAULT_WORKSPACE_ID;
    const dir = isDefault ? null : typeof value.dir === "string" ? value.dir : "";
    if (dir !== null && (!isAbsolute(dir) || dirs.has(resolve(dir)))) continue;
    try {
      const fields = editableFields(value, false);
      const agentId = agents.some((agent) => agent.id === fields.agentId) ? fields.agentId : null;
      workspaces.push({ id, ...fields, agentId, dir: dir === null ? null : resolve(dir) });
      ids.add(id);
      if (dir !== null) dirs.add(resolve(dir));
    } catch {
      // A nameless entry; the rest of the workspaces still load.
    }
  }
  if (!ids.has(DEFAULT_WORKSPACE_ID)) workspaces.unshift(structuredClone(DEFAULT_WORKSPACE));
  return workspaces;
}

/** One workspace per distinct folder an agent of an older settings file worked in. */
function legacyEntries(agents: readonly AgentProfile[], rawAgents: unknown): WorkspaceProfile[] {
  const folders = new Map<string, unknown>();
  for (const entry of Array.isArray(rawAgents) ? rawAgents : []) {
    const value = asLoose(entry) as { id?: unknown; workspaceDir?: unknown } | null;
    if (typeof value?.id === "string") folders.set(value.id, value.workspaceDir);
  }
  const taken: WorkspaceProfile[] = [];
  const dirs = new Set<string>();
  for (const agent of agents) {
    const dir = folders.get(agent.id);
    if (typeof dir !== "string" || !isAbsolute(dir) || dirs.has(resolve(dir))) continue;
    dirs.add(resolve(dir));
    const name = uniqueName(taken, agent.name);
    taken.push({
      ...structuredClone(DEFAULT_WORKSPACE),
      id: newWorkspaceId(taken, name),
      name,
      icon: agent.icon,
      dir: resolve(dir),
      agentId: agent.id,
    });
  }
  return taken;
}

/** Throws when another workspace already uses `name` (names compare case-insensitively). */
export function assertUniqueName(
  workspaces: readonly WorkspaceProfile[],
  name: string,
  exceptId?: string,
): void {
  const key = name.toLocaleLowerCase();
  if (workspaces.some((item) => item.id !== exceptId && item.name.toLocaleLowerCase() === key))
    throw new Error(`A workspace named ${name} already exists.`);
}

function uniqueName(workspaces: readonly WorkspaceProfile[], name: string): string {
  const taken = new Set(workspaces.map((item) => item.name.toLocaleLowerCase()));
  if (!taken.has(name.toLocaleLowerCase())) return name;
  for (let suffix = 2; ; suffix += 1) {
    const tail = ` (${suffix})`;
    const candidate = `${name.slice(0, MAX_NAME_LENGTH - tail.length)}${tail}`;
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

/** `ws-<slug of name>`, with a number appended when another workspace already uses it. */
export function newWorkspaceId(workspaces: readonly WorkspaceProfile[], name: string): string {
  const taken = new Set(workspaces.map((item) => item.id));
  const slug =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "workspace";
  let id = `${ID_PREFIX}${slug}`;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${ID_PREFIX}${slug}-${suffix}`;
  return id;
}

/**
 * The folder of a new workspace, checked before it is saved: an absolute path, created when
 * missing, and not the folder of another workspace.
 */
export async function prepareFolder(
  dir: string | null,
  workspaces: readonly WorkspaceProfile[],
  defaultDir: string,
): Promise<string> {
  const trimmed = dir?.trim() ?? "";
  if (!trimmed) throw new Error("Choose the workspace folder with “Choose…”.");
  if (!isAbsolute(trimmed)) throw new Error("Choose the workspace folder with “Choose…”.");
  const path = resolve(trimmed);
  const owner = workspaces.find(
    (workspace) => resolve(workspaceFolder(workspace, defaultDir)) === path,
  );
  if (owner) throw new Error(`This folder already belongs to the workspace ${owner.name}.`);
  const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (info && !info.isDirectory()) throw new Error("The workspace must be a folder, not a file.");
  if (!info) await mkdir(path, { recursive: true });
  return path;
}

/** System prompt section with the workspace's rules; undefined while it has none. */
export function workspacePromptSection(workspace: WorkspaceProfile): string | undefined {
  if (!workspace.instructions) return undefined;
  return `## Workspace: ${workspace.icon} ${workspace.name}\n\n${workspace.instructions}`;
}
