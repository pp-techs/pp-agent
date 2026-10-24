/**
 * `office_read` and `office_edit`: Word, Excel, and PowerPoint files through the bundled OfficeCLI
 * binary (https://github.com/iOfficeAI/OfficeCLI, Apache-2.0). The model passes the same
 * subcommands and options as the `officecli` command line; `args.ts` checks them first.
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { EDIT_COMMANDS, READ_COMMANDS, type OfficeTool, validateOfficeCall } from "./args.ts";
import { OFFICE_EDIT_TOOL, OFFICE_READ_TOOL } from "./names.ts";
import { prepareOutputs, runOfficeCli } from "./run.ts";

/** Keeps one large document from filling the context window. */
const MAX_CHARS = 60_000;

export interface OfficeToolOptions {
  workspaceDir: string;
  /** Private folder for the binary's own settings and state. */
  homeDir: string;
  /** Replaces the bundled binary; tests only. */
  binary?: string;
  baseEnv?: NodeJS.ProcessEnv;
}

const parameters = Type.Object({
  command: Type.String({ description: "The officecli subcommand, such as view, get, add, or set" }),
  file: Type.Optional(
    Type.String({
      description:
        "The .docx, .xlsx, or .pptx file, relative to the workspace (omit for help and load_skill)",
    }),
  ),
  args: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Remaining arguments in order, one per item, exactly as on the officecli command line, e.g. ["/body", "--type", "paragraph", "--prop", "text=Hello"]. Never quote or escape them for a shell.',
    }),
  ),
});

function trim(text: string): string {
  return text.length > MAX_CHARS
    ? `${text.slice(0, MAX_CHARS)}\n\n[Cut off: showing ${MAX_CHARS} of ${text.length} characters. Ask for a smaller part with --start/--end, --max-lines, or a narrower path.]`
    : text;
}

function createOfficeTool(tool: OfficeTool, options: OfficeToolOptions) {
  const reading = tool === "read";
  return defineTool({
    name: reading ? OFFICE_READ_TOOL : OFFICE_EDIT_TOOL,
    label: reading ? "Read Office file" : "Edit Office file",
    description: reading
      ? "Inspects Word, Excel, and PowerPoint files with OfficeCLI without changing them. " +
        `Commands: ${READ_COMMANDS.join(", ")}. Arguments are the same as for the officecli command line ` +
        '(for example command `view`, file `report.docx`, args `["outline"]`; `get` with a path such as `/body/p[1]`; `query` with a selector). ' +
        "`help` prints the property reference; `load_skill` prints built-in workflow guides."
      : "Creates and changes Word, Excel, and PowerPoint files with OfficeCLI. " +
        `Commands: ${EDIT_COMMANDS.join(", ")}. Arguments are the same as for the officecli command line ` +
        '(for example command `create`, file `report.docx`; command `add`, file `report.docx`, args `["/body", "--type", "paragraph", "--prop", "text=Hello"]`; ' +
        "use `batch` with `--commands` to apply many changes in one call). Files must be inside the workspace; images are read from workspace paths.",
    promptSnippet: reading
      ? "Inspect Word, Excel, and PowerPoint files (officecli view, get, query, validate)"
      : "Create and edit Word, Excel, and PowerPoint files (officecli create, add, set, batch)",
    promptGuidelines: reading
      ? ["Use office_read, not read, for the structure of .docx, .xlsx, and .pptx files"]
      : [
          "Use office_edit to create or change .docx, .xlsx, and .pptx files; check the result with office_read (validate, view)",
        ],
    // One command at a time: two commands on the same file would race.
    executionMode: "sequential",
    parameters,
    async execute(_toolCallId, params, signal) {
      const call = await validateOfficeCall(
        tool,
        options.workspaceDir,
        params.command,
        params.file,
        params.args ?? [],
      );
      await prepareOutputs(call.outputs);
      const result = await runOfficeCli({
        cwd: options.workspaceDir,
        homeDir: options.homeDir,
        argv: call.argv,
        ...(call.batchJson === undefined ? {} : { stdin: call.batchJson }),
        signal,
        ...(options.binary ? { binary: options.binary } : {}),
        ...(options.baseEnv ? { baseEnv: options.baseEnv } : {}),
      });
      const text = trim(result.output.trim() || "(no output)");
      if (result.exitCode === 1) throw new Error(text);
      return {
        content: [
          {
            type: "text",
            text:
              result.exitCode === 0
                ? text
                : `${text}\n\n[Finished with warnings (exit code ${result.exitCode}).]`,
          },
        ],
        details: undefined,
      };
    },
  });
}

export function createOfficeTools(options: OfficeToolOptions) {
  return [createOfficeTool("read", options), createOfficeTool("edit", options)];
}
