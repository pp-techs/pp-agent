/**
 * Validation of the arguments the model passes to OfficeCLI. The tools never use a shell and only
 * run subcommands listed here; every option is checked against a per-command table, and every file
 * the command would read or write must resolve inside the workspace.
 */
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { resolveInWorkspace } from "./files.ts";

export const OFFICE_EXTENSIONS = [".docx", ".xlsx", ".pptx"];

export const READ_COMMANDS = [
  "help",
  "load_skill",
  "view",
  "get",
  "query",
  "validate",
  "raw",
  "dump",
] as const;
export const EDIT_COMMANDS = [
  "create",
  "add",
  "set",
  "remove",
  "move",
  "swap",
  "batch",
  "raw-set",
  "add-part",
  "import",
  "merge",
  "view",
] as const;

export type OfficeTool = "read" | "edit";

/** `view` modes that print text to stdout; the others render a file and need `--out`. */
const TEXT_VIEW_MODES = ["text", "annotated", "outline", "stats", "issues", "forms", "html"];
const RENDER_VIEW_MODES = ["html", "svg", "screenshot"];

/** How a flag's value is treated. `switch` takes none. */
type FlagKind = "switch" | "value" | "prop" | "out" | "in" | "commands" | "data";
type PositionalKind = "text" | "out" | "in";

interface CommandSpec {
  /** Whether the command takes the Office file as its first argument. */
  file: boolean;
  positionals: ReadonlyArray<{ kind: PositionalKind; optional?: boolean }>;
  flags: Readonly<Record<string, FlagKind>>;
}

const JSON_FLAG = { "--json": "switch" } as const;
const MOVE_FLAGS = {
  "--index": "value",
  "--after": "value",
  "--before": "value",
  "--prop": "prop",
  ...JSON_FLAG,
} as const;
const VIEW_FLAGS = {
  "--start": "value",
  "--end": "value",
  "--max-lines": "value",
  "--type": "value",
  "--limit": "value",
  "--cols": "value",
  "--page": "value",
  ...JSON_FLAG,
} as const;

const SPECS: Record<string, CommandSpec> = {
  help: {
    file: false,
    positionals: [
      { kind: "text", optional: true },
      { kind: "text", optional: true },
      { kind: "text", optional: true },
    ],
    flags: { ...JSON_FLAG, "--jsonl": "switch" },
  },
  // Prints a skill that is built into the binary; no file or network access.
  load_skill: {
    file: false,
    positionals: [{ kind: "text", optional: true }],
    flags: { "--path": "value" },
  },
  view: {
    file: true,
    positionals: [{ kind: "text" }],
    flags: {
      ...VIEW_FLAGS,
      "-o": "out",
      "--out": "out",
      "--range": "value",
      "--screenshot-width": "value",
      "--screenshot-height": "value",
      "--grid": "value",
      "--render": "value",
    },
  },
  get: {
    file: true,
    positionals: [{ kind: "text", optional: true }],
    flags: { "--depth": "value", ...JSON_FLAG },
  },
  query: {
    file: true,
    positionals: [{ kind: "text" }],
    flags: { "--find": "value", "--compact": "switch", "--fields": "value", ...JSON_FLAG },
  },
  validate: { file: true, positionals: [], flags: JSON_FLAG },
  raw: {
    file: true,
    positionals: [{ kind: "text", optional: true }],
    flags: { "--start": "value", "--end": "value", "--cols": "value", ...JSON_FLAG },
  },
  dump: { file: true, positionals: [{ kind: "text", optional: true }], flags: JSON_FLAG },
  create: {
    file: true,
    positionals: [],
    flags: {
      "--type": "value",
      "--force": "switch",
      "--locale": "value",
      "--minimal": "switch",
      ...JSON_FLAG,
    },
  },
  add: {
    file: true,
    positionals: [{ kind: "text" }],
    flags: { "--type": "value", "--from": "value", ...MOVE_FLAGS },
  },
  set: {
    file: true,
    positionals: [{ kind: "text" }],
    flags: { "--prop": "prop", "--find": "value", "--replace": "value", ...JSON_FLAG },
  },
  remove: {
    file: true,
    positionals: [{ kind: "text" }],
    flags: { "--shift": "value", "--prop": "prop", ...JSON_FLAG },
  },
  move: {
    file: true,
    positionals: [{ kind: "text" }],
    flags: { "--to": "value", ...MOVE_FLAGS },
  },
  swap: { file: true, positionals: [{ kind: "text" }, { kind: "text" }], flags: JSON_FLAG },
  batch: {
    file: true,
    positionals: [],
    flags: {
      "--commands": "commands",
      "--stop-on-error": "switch",
      "--best-effort": "switch",
      ...JSON_FLAG,
    },
  },
  "raw-set": {
    file: true,
    positionals: [{ kind: "text" }],
    flags: { "--xpath": "value", "--action": "value", "--xml": "value", ...JSON_FLAG },
  },
  "add-part": {
    file: true,
    positionals: [{ kind: "text" }],
    flags: { "--type": "value", ...JSON_FLAG },
  },
  import: {
    file: true,
    positionals: [{ kind: "text" }, { kind: "in", optional: true }],
    flags: {
      "--file": "in",
      "--format": "value",
      "--delimiter": "value",
      "--decimal": "value",
      "--start-cell": "value",
      "--header": "switch",
      ...JSON_FLAG,
    },
  },
  merge: {
    file: true,
    positionals: [{ kind: "out" }],
    flags: { "--data": "data", "--force": "switch", ...JSON_FLAG },
  },
};

/** Property names whose value OfficeCLI loads from a file or URL. */
const FILE_PROPS = ["src", "path", "image", "imagefill", "preview", "fallback", "poster", "data"];

/** Verbs and fields a `batch` item may use. */
const BATCH_VERBS = ["add", "set", "remove", "move", "swap", "get", "query", "raw-set", "meta"];
const BATCH_FIELDS = [
  "command",
  "parent",
  "path",
  "path2",
  "selector",
  "type",
  "props",
  "to",
  "after",
  "before",
  "index",
  "from",
  "find",
  "replace",
  "shift",
  "part",
  "xpath",
  "action",
  "xml",
  "depth",
  "dumpVersion",
];
const MAX_BATCH_ITEMS = 500;
const MAX_BATCH_BYTES = 1024 * 1024;
const MAX_ARGS = 400;

export interface ValidatedCall {
  /** Arguments for the binary, file paths absolute. */
  argv: string[];
  /** Validated JSON for `batch`; the runner sends it on standard input. */
  batchJson?: string;
  /** Files the command creates; the runner creates their folders first. */
  outputs: string[];
  /** The command as a person would type it, for approval cards and logs. */
  display: string;
}

/** Any `scheme:` (two or more letters, so `C:` drive letters pass) except inline `data:` URIs. */
const SCHEME = /^[a-z][a-z0-9+.-]+:/i;

/**
 * Checks a value OfficeCLI would load from disk or the network. Relative paths resolve against the
 * workspace (the binary runs there), the same way `resolveInWorkspace` resolves them.
 */
async function checkSource(workspaceDir: string, key: string, value: string): Promise<void> {
  const text = value.trim();
  if (/^data:/i.test(text)) return;
  const refused = `${key}: web addresses, file: links, and network shares are not allowed. Save the file in the workspace and use its path.`;
  if (text.startsWith("\\\\") || text.startsWith("//")) throw new Error(refused);
  if (text.startsWith("~"))
    throw new Error(`${key}: the file must be inside the workspace folder.`);
  if (key.toLowerCase().split(".").pop() === "data") {
    // `data` is inline table rows ("H1,H2;R1,R2"), a chart series ("Sales:1,2,3"), or a CSV file.
    if (/^[a-z][a-z0-9+.-]+:\/\//i.test(text) || /^file:/i.test(text)) throw new Error(refused);
    if (/[,;\n:]/.test(text) && !/^[A-Za-z]:[\\/]/.test(text)) return;
  } else if (SCHEME.test(text)) {
    throw new Error(refused);
  }
  await resolveInWorkspace(workspaceDir, text);
}

/** Validates one `key=value` property whose value may name a file. */
async function checkProp(workspaceDir: string, assignment: string): Promise<void> {
  const split = assignment.indexOf("=");
  if (split <= 0) throw new Error(`--prop needs key=value, got "${assignment}".`);
  const key = assignment.slice(0, split).trim();
  const lower = key.toLowerCase();
  // `basedOn.path` names a style, not a file.
  if (lower.startsWith("basedon") || !FILE_PROPS.includes(lower.split(".").pop() ?? "")) return;
  await checkSource(workspaceDir, key, assignment.slice(split + 1));
}

async function checkBatch(workspaceDir: string, json: string): Promise<string> {
  if (json.length > MAX_BATCH_BYTES) throw new Error("The batch is larger than 1 MB.");
  let items: unknown;
  try {
    items = JSON.parse(json);
  } catch {
    throw new Error("--commands must be a JSON array of operations.");
  }
  if (!Array.isArray(items)) throw new Error("--commands must be a JSON array of operations.");
  if (items.length > MAX_BATCH_ITEMS)
    throw new Error(`A batch holds at most ${MAX_BATCH_ITEMS} operations.`);
  for (const [index, item] of items.entries()) {
    const at = `Batch item ${index + 1}`;
    if (typeof item !== "object" || item === null || Array.isArray(item))
      throw new Error(`${at} must be an object.`);
    const record = item as Record<string, unknown>;
    if (typeof record.command !== "string" || !BATCH_VERBS.includes(record.command))
      throw new Error(`${at}: "command" must be one of ${BATCH_VERBS.join(", ")}.`);
    for (const field of Object.keys(record))
      if (!BATCH_FIELDS.includes(field))
        throw new Error(`${at}: unknown field "${field}". Allowed: ${BATCH_FIELDS.join(", ")}.`);
    const props = record.props;
    if (props === undefined) continue;
    if (typeof props !== "object" || props === null || Array.isArray(props))
      throw new Error(`${at}: "props" must be an object.`);
    for (const [key, value] of Object.entries(props))
      if (typeof value === "string") await checkProp(workspaceDir, `${key}=${value}`);
  }
  return JSON.stringify(items);
}

async function officeFile(
  workspaceDir: string,
  path: string,
  mustExist: boolean,
): Promise<{ absolute: string; display: string }> {
  const extension = extname(path).toLowerCase();
  if (!OFFICE_EXTENSIONS.includes(extension))
    throw new Error(`${path}: expected a ${OFFICE_EXTENSIONS.join(", ")} file.`);
  const file = await resolveInWorkspace(workspaceDir, path);
  const info = await stat(file.absolute).catch(() => null);
  if (info?.isDirectory()) throw new Error(`${file.display} is a folder.`);
  if (mustExist && !info) throw new Error(`${file.display} does not exist.`);
  return file;
}

/**
 * Turns the model's `command`, `file`, and `args` into a safe argument list, or throws an error
 * that tells the model what to change.
 */
export async function validateOfficeCall(
  tool: OfficeTool,
  workspaceDir: string,
  command: string,
  file: string | undefined,
  args: readonly string[],
): Promise<ValidatedCall> {
  const allowed: readonly string[] = tool === "read" ? READ_COMMANDS : EDIT_COMMANDS;
  if (!allowed.includes(command))
    throw new Error(
      `"${command}" is not available in ${tool === "read" ? "office_read" : "office_edit"}. Allowed: ${allowed.join(", ")}.` +
        (tool === "read" && (EDIT_COMMANDS as readonly string[]).includes(command)
          ? " Use office_edit for commands that change files."
          : ""),
    );
  const spec = SPECS[command];
  if (!spec) throw new Error(`"${command}" is not available.`);
  if (args.length > MAX_ARGS) throw new Error(`Too many arguments (at most ${MAX_ARGS}).`);

  const argv: string[] = [command];
  const outputs: string[] = [];
  let shown = file ?? "";
  if (spec.file) {
    if (!file) throw new Error(`${command} needs a file.`);
    const mustExist = command !== "create";
    const resolved = await officeFile(workspaceDir, file, mustExist);
    argv.push(resolved.absolute);
    shown = resolved.display;
    if (command === "create") outputs.push(resolved.absolute);
  } else if (file) {
    throw new Error(`${command} takes no file.`);
  }

  const seen = new Set<string>();
  let positional = 0;
  let batchJson: string | undefined;
  let outFlag = false;
  let viewMode = "";
  for (let i = 0; i < args.length; i++) {
    const token = args[i] ?? "";
    if (!token.startsWith("-") || token === "-") {
      const slot = spec.positionals[positional];
      if (!slot) throw new Error(`Unexpected argument "${token}" for ${command}.`);
      positional += 1;
      if (slot.kind === "text") {
        if (command === "view" && positional === 1) viewMode = token.toLowerCase();
        argv.push(token);
      } else {
        const target = await officeFileOrData(workspaceDir, slot.kind, token);
        argv.push(target);
        if (slot.kind === "out") outputs.push(target);
      }
      continue;
    }
    const kind = spec.flags[token];
    if (!kind) {
      const known = Object.keys(spec.flags).join(" ");
      throw new Error(
        `Option ${token} is not allowed for ${command}. Allowed: ${known || "none"}.`,
      );
    }
    if (kind !== "prop" && seen.has(token)) throw new Error(`Option ${token} is given twice.`);
    seen.add(token);
    if (kind === "switch") {
      argv.push(token);
      continue;
    }
    const value = args[i + 1];
    if (value === undefined) throw new Error(`Option ${token} needs a value.`);
    i += 1;
    switch (kind) {
      case "value":
        argv.push(token, value);
        break;
      case "prop":
        await checkProp(workspaceDir, value);
        argv.push(token, value);
        break;
      case "out": {
        const out = await resolveInWorkspace(workspaceDir, value);
        outputs.push(out.absolute);
        outFlag = true;
        argv.push(token, out.absolute);
        break;
      }
      case "in": {
        const source = await resolveInWorkspace(workspaceDir, value);
        argv.push(token, source.absolute);
        break;
      }
      case "commands":
        batchJson = await checkBatch(workspaceDir, value);
        break;
      case "data": {
        const trimmed = value.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) argv.push(token, value);
        else argv.push(token, (await resolveInWorkspace(workspaceDir, value)).absolute);
        break;
      }
    }
  }

  const required = spec.positionals.filter((slot) => !slot.optional).length;
  if (positional < required)
    throw new Error(`${command} needs ${required} argument(s) after the file, got ${positional}.`);
  if (command === "batch" && batchJson === undefined)
    throw new Error('batch needs --commands with a JSON array, e.g. ["--commands", "[{...}]"].');

  if (command === "view") {
    if (tool === "read" && !TEXT_VIEW_MODES.includes(viewMode))
      throw new Error(
        `view mode "${viewMode}" is not available in office_read. Modes: ${TEXT_VIEW_MODES.join(", ")}.`,
      );
    if (tool === "read" && outFlag) throw new Error("office_read cannot write files; drop --out.");
    if (tool === "edit") {
      if (!RENDER_VIEW_MODES.includes(viewMode))
        throw new Error(
          `office_edit renders ${RENDER_VIEW_MODES.join(", ")} with --out; use office_read for text views.`,
        );
      if (!outFlag) throw new Error(`view ${viewMode} needs --out <file inside the workspace>.`);
    }
  }

  const display = [command, shown, ...args].join(" ");
  return { argv, ...(batchJson === undefined ? {} : { batchJson }), outputs, display };
}

async function officeFileOrData(
  workspaceDir: string,
  kind: PositionalKind,
  token: string,
): Promise<string> {
  if (kind === "out") return (await officeFile(workspaceDir, token, false)).absolute;
  return (await resolveInWorkspace(workspaceDir, token)).absolute;
}
