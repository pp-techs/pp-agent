/**
 * Agents: profiles with their own rules, tools, MCP servers, skills, model, and starter prompts.
 * Stored in settings.json (`SettingsFile.agents`); this module validates them, makes ids, and
 * reads and writes exported agent files.
 */
import {
  type AgentExportFile,
  type AgentProfile,
  type AgentSummary,
  type AgentToolOption,
  type AppSettings,
  DEFAULT_AGENT_ID,
  type ModelRef,
  type SaveAgentInput,
} from "@workspace/shared";
import { t } from "./i18n.ts";
import { AGENT_TOOLS, toolRule, toolTier } from "./tools.ts";

const MAX_NAME_LENGTH = 60;
const MAX_ICON_LENGTH = 8;
const MAX_STARTER_PROMPTS = 20;
const MAX_STARTER_PROMPT_LENGTH = 300;
const MAX_INSTRUCTIONS_LENGTH = 20_000;
const MAX_DESCRIPTION_LENGTH = 1_000;
const DEFAULT_ICON = "🤖";
const ID_PREFIX = "ag-";

/** Custom session entry that records which agent a conversation uses (`data: { agentId }`). */
export const AGENT_ENTRY_TYPE = "pp-agent";

export const DEFAULT_AGENT: AgentProfile = {
  id: DEFAULT_AGENT_ID,
  name: "PP Agent",
  icon: DEFAULT_ICON,
  description: "",
  instructions: "",
  tools: null,
  mcpServers: null,
  skills: null,
  model: null,
  starterPrompts: [],
  memory: true,
};

/** Agent fields without the id: what an exported file carries. */
type PortableAgent = AgentExportFile["agent"];

export function summarizeAgent(agent: AgentProfile): AgentSummary {
  return { id: agent.id, name: agent.name, icon: agent.icon };
}

/** Default agent first, then by name. */
export function sortAgents(agents: readonly AgentProfile[]): AgentProfile[] {
  return [...agents].sort(
    (a, b) =>
      Number(b.id === DEFAULT_AGENT_ID) - Number(a.id === DEFAULT_AGENT_ID) ||
      a.name.localeCompare(b.name),
  );
}

/** The agent with `id`, or the default agent when it no longer exists. */
export function findAgent(agents: readonly AgentProfile[], id: string | null): AgentProfile {
  return (
    agents.find((agent) => agent.id === id) ??
    agents.find((agent) => agent.id === DEFAULT_AGENT_ID) ??
    DEFAULT_AGENT
  );
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

/** Field-by-field values of an untrusted object (settings.json, an imported file). */
type Loose = Partial<Record<keyof AgentProfile, unknown>>;

function asLoose(value: unknown): Loose | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Loose)
    : null;
}

/** Trimmed, de-duplicated non-empty strings; null stays null ("all of them"). */
function nameList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const names = value
    .filter((name): name is string => typeof name === "string")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  return [...new Set(names)];
}

export function modelRef(value: unknown): ModelRef | null {
  const object = asLoose(value) as Partial<Record<keyof ModelRef, unknown>> | null;
  if (!object) return null;
  const { provider, modelId } = object;
  return typeof provider === "string" && provider && typeof modelId === "string" && modelId
    ? { provider, modelId }
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The portable fields of an agent from untrusted input. `strict` throws plain-English errors for
 * values a person typed; otherwise values that do not fit are shortened or dropped.
 */
function portableAgent(value: Loose, strict: boolean): PortableAgent {
  const fail = (message: string): never => {
    throw new Error(message);
  };
  const name = text(value.name);
  if (!name) fail(t("agents.nameRequired"));
  if (name.length > MAX_NAME_LENGTH && strict)
    fail(t("limits.nameTooLong", { max: MAX_NAME_LENGTH }));
  const icon = text(value.icon);
  if (icon.length > MAX_ICON_LENGTH && strict) fail(t("limits.iconNotEmoji"));
  const description = text(value.description);
  if (description.length > MAX_DESCRIPTION_LENGTH && strict)
    fail(t("limits.descriptionTooLong", { max: MAX_DESCRIPTION_LENGTH }));
  const instructions = text(value.instructions);
  if (instructions.length > MAX_INSTRUCTIONS_LENGTH && strict)
    fail(t("limits.instructionsTooLong", { max: MAX_INSTRUCTIONS_LENGTH }));
  const prompts = (nameList(value.starterPrompts) ?? []).map((prompt) => prompt.trim());
  if (strict) {
    if (prompts.length > MAX_STARTER_PROMPTS)
      fail(t("agents.tooManyStarterPrompts", { max: MAX_STARTER_PROMPTS }));
    if (prompts.some((prompt) => prompt.length > MAX_STARTER_PROMPT_LENGTH))
      fail(t("agents.starterPromptTooLong", { max: MAX_STARTER_PROMPT_LENGTH }));
  }
  return {
    name: name.slice(0, MAX_NAME_LENGTH),
    icon: icon && icon.length <= MAX_ICON_LENGTH ? icon : DEFAULT_ICON,
    description: description.slice(0, MAX_DESCRIPTION_LENGTH),
    instructions: instructions.slice(0, MAX_INSTRUCTIONS_LENGTH),
    tools: nameList(value.tools),
    mcpServers: nameList(value.mcpServers),
    skills: nameList(value.skills),
    model: modelRef(value.model),
    starterPrompts: prompts
      .slice(0, MAX_STARTER_PROMPTS)
      .map((prompt) => prompt.slice(0, MAX_STARTER_PROMPT_LENGTH)),
    memory: value.memory !== false,
  };
}

/** Validated fields of an agent being saved; throws a message for the person otherwise. */
export function validateAgentInput(input: SaveAgentInput): PortableAgent {
  return portableAgent(input as Loose, true);
}

/**
 * Agents read from settings.json. Entries that do not fit are dropped one by one, duplicate ids
 * keep the first, and the default agent is added when missing.
 */
export function readAgents(raw: unknown): AgentProfile[] {
  const agents: AgentProfile[] = [];
  const ids = new Set<string>();
  for (const entry of Array.isArray(raw) ? raw : []) {
    const value = asLoose(entry);
    const id = typeof value?.id === "string" ? value.id : "";
    if (!value || !id || ids.has(id)) continue;
    try {
      agents.push({ id, ...portableAgent(value, false) });
      ids.add(id);
    } catch {
      // A nameless entry; the rest of the agents still load.
    }
  }
  if (!ids.has(DEFAULT_AGENT_ID)) agents.unshift(structuredClone(DEFAULT_AGENT));
  return agents;
}

/** Throws when another agent already uses `name` (names compare case-insensitively). */
export function assertUniqueName(
  agents: readonly AgentProfile[],
  name: string,
  exceptId?: string,
): void {
  const key = name.toLocaleLowerCase();
  if (agents.some((agent) => agent.id !== exceptId && agent.name.toLocaleLowerCase() === key))
    throw new Error(t("agents.nameTaken", { name }));
}

/** `name`, or `name (2)`, `name (3)` … when another agent already uses it. */
export function uniqueName(agents: readonly AgentProfile[], name: string): string {
  const taken = new Set(agents.map((agent) => agent.name.toLocaleLowerCase()));
  if (!taken.has(name.toLocaleLowerCase())) return name;
  for (let suffix = 2; ; suffix += 1) {
    const tail = ` (${suffix})`;
    const candidate = `${name.slice(0, MAX_NAME_LENGTH - tail.length)}${tail}`;
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

/** `ag-<slug of name>`, with a number appended when another agent already uses it. */
export function newAgentId(agents: readonly AgentProfile[], name: string): string {
  const taken = new Set(agents.map((agent) => agent.id));
  const slug =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "agent";
  let id = `${ID_PREFIX}${slug}`;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${ID_PREFIX}${slug}-${suffix}`;
  return id;
}

// ---------------------------------------------------------------------------------------------
// Import and export
// ---------------------------------------------------------------------------------------------

export function exportAgent(agent: AgentProfile): string {
  const file: AgentExportFile = {
    ppAgentExport: 1,
    agent: {
      name: agent.name,
      icon: agent.icon,
      description: agent.description,
      instructions: agent.instructions,
      tools: agent.tools,
      mcpServers: agent.mcpServers,
      skills: agent.skills,
      model: agent.model,
      starterPrompts: agent.starterPrompts,
      memory: agent.memory,
    },
  };
  return JSON.stringify(file, null, 2);
}

/**
 * The agent of an exported file. Tools, servers, and skills this computer does not have are kept;
 * they may be installed later.
 */
export function parseAgentExport(json: string): PortableAgent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(t("agents.notExportedJson"));
  }
  const file = asLoose(parsed) as { ppAgentExport?: unknown; agent?: unknown } | null;
  const agent = asLoose(file?.agent);
  if (file?.ppAgentExport !== 1 || !agent) throw new Error(t("agents.notExported"));
  return portableAgent(agent, false);
}

// ---------------------------------------------------------------------------------------------
// Prompt and tools
// ---------------------------------------------------------------------------------------------

/**
 * System prompt section that tells the model which agent it is and its rules; undefined for the
 * default agent while it has no description or instructions.
 */
export function agentPromptSection(agent: AgentProfile): string | undefined {
  if (agent.id === DEFAULT_AGENT_ID && !agent.description && !agent.instructions) return undefined;
  const heading = `## Active agent: ${agent.icon} ${agent.name}`;
  const intro = agent.description ? `${heading}\n${agent.description}` : heading;
  return agent.instructions ? `${intro}\n\n${agent.instructions}` : intro;
}

const TOOL_TEXT: Record<string, { label: string; description: string }> = {
  read: { label: "Read files", description: "Open text files in the workspace." },
  ls: { label: "List folders", description: "See which files a folder contains." },
  find: { label: "Find files by name", description: "Look for files whose names match." },
  grep: { label: "Search inside files", description: "Find text inside files." },
  read_document: {
    label: "Read documents (Word, Excel, PDF…)",
    description: "Read office documents and PDFs.",
  },
  current_datetime: {
    label: "Current date and time",
    description: "Check today's date, the time, and the time zone.",
  },
  web_search: { label: "Search the web", description: "Look things up on the internet." },
  web_fetch: { label: "Open web pages", description: "Read the content of a web address." },
  memory_save: {
    label: "Remember notes",
    description: "Keep short facts and preferences; asks first.",
  },
  memory_list: { label: "List saved notes", description: "See what the agent remembers." },
  memory_search: {
    label: "Search saved notes",
    description: "Look for something the agent remembers.",
  },
  memory_forget: { label: "Forget notes", description: "Remove a saved note; asks first." },
  todo_write: {
    label: "Plan with a checklist",
    description: "Keep a checklist for tasks with several steps.",
  },
  delegate_task: {
    label: "Hand off research",
    description: "Give a focused read-only task to a helper and get back a summary.",
  },
  ask_user: {
    label: "Ask you questions",
    description: "Ask you to choose between options when it needs your decision.",
  },
  sessions: {
    label: "See other conversations",
    description: "List and read saved conversations, and see which chats it can deliver to.",
  },
  schedule_manage: {
    label: "Scheduled tasks",
    description: "Create and manage tasks that run on a schedule; asks first when creating.",
  },
  office_read: {
    label: "Inspect Word, Excel, PowerPoint files",
    description: "Look at the structure and content of Office files without changing them.",
  },
  office_edit: {
    label: "Create and edit Word, Excel, PowerPoint files",
    description: "Build and change Office files in the workspace; asks first.",
  },
  write: { label: "Create and save files", description: "Save new files; asks first." },
  edit: { label: "Edit parts of files", description: "Change parts of existing files." },
  bash: {
    label: "Run shell commands",
    description: "Run commands on this computer; asks first unless set to run freely.",
  },
  powershell: {
    label: "Run PowerShell commands",
    description: "Run commands on this computer; asks first unless set to run freely.",
  },
};

/** App tools an agent can be limited to, and whether Settings › Tools turns them off anyway. */
export function agentToolOptions(settings: AppSettings): AgentToolOption[] {
  return AGENT_TOOLS.map((name) => ({
    name,
    label: TOOL_TEXT[name]?.label ?? name,
    description: TOOL_TEXT[name]?.description ?? "",
    globallyOff: toolRule(name, toolTier(name), settings).effective === "off",
  }));
}
