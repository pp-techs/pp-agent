import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  migrateWorkspaceInstructions,
  readWorkspaceInstructions,
  saveWorkspaceInstructions,
} from "./workspace-instructions.ts";
import { legacyInstructions } from "./workspaces.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pp-ws-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("legacyInstructions", () => {
  test("keeps only workspaces with text and a usable folder", () => {
    expect(
      legacyInstructions([
        { id: "default", instructions: " Be brief. " },
        { id: "ws-a", dir: "/work/a", instructions: "Rules" },
        { id: "ws-b", dir: "relative", instructions: "Rules" },
        { id: "ws-c", dir: "/work/c", instructions: "  " },
        { id: "ws-d", dir: "/work/d" },
      ]),
    ).toEqual([
      { id: "default", dir: null, instructions: "Be brief." },
      { id: "ws-a", dir: "/work/a", instructions: "Rules" },
    ]);
  });

  test("a file without workspaces has nothing to move", () => {
    expect(legacyInstructions(undefined)).toEqual([]);
  });
});

describe("migrateWorkspaceInstructions", () => {
  test("creates AGENTS.md in the workspace folder, and in the default folder for the built-in one", () => {
    const folder = join(root, "ws");
    const defaultFolder = join(root, "home");
    migrateWorkspaceInstructions(
      [
        { id: "ws-a", dir: folder, instructions: "Answer in Vietnamese." },
        { id: "default", dir: null, instructions: "Be brief." },
      ],
      defaultFolder,
      root,
    );
    expect(readFileSync(join(folder, "AGENTS.md"), "utf8")).toBe("Answer in Vietnamese.\n");
    expect(readFileSync(join(defaultFolder, "AGENTS.md"), "utf8")).toBe("Be brief.\n");
  });

  test("appends to an existing AGENTS.md without losing it, and only once", () => {
    const folder = join(root, "ws");
    mkdirSync(folder);
    writeFileSync(join(folder, "AGENTS.md"), "# Repo rules\n\nUse pnpm.\n");
    const entries = [{ id: "ws-a", dir: folder, instructions: "Answer in Vietnamese." }];
    migrateWorkspaceInstructions(entries, root, root);
    migrateWorkspaceInstructions(entries, root, root);
    expect(readFileSync(join(folder, "AGENTS.md"), "utf8")).toBe(
      "# Repo rules\n\nUse pnpm.\n\n## Workspace instructions\n\nAnswer in Vietnamese.\n",
    );
  });

  test("keeps the text in the backup folder when the workspace folder cannot be written", () => {
    // A file where the folder should be makes the write fail.
    const blocked = join(root, "blocked");
    writeFileSync(blocked, "");
    migrateWorkspaceInstructions(
      [{ id: "ws-a", dir: join(blocked, "inner"), instructions: "Keep me." }],
      root,
      root,
    );
    expect(readFileSync(join(root, "workspace-instructions-ws-a.md"), "utf8")).toBe("Keep me.\n");
  });
});

describe("workspace AGENTS.md", () => {
  test("reads the folder's own file and lists the ones loaded from above", async () => {
    const parent = join(root, "repo");
    const folder = join(parent, "ws");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(parent, "AGENTS.md"), "Repo rules");
    const agentDir = join(root, "agent");
    mkdirSync(agentDir);

    expect(await readWorkspaceInstructions(folder, agentDir)).toMatchObject({
      path: join(folder, "AGENTS.md"),
      content: "",
      exists: false,
      overridden: false,
      inherited: [join(parent, "AGENTS.md")],
    });

    await saveWorkspaceInstructions(folder, "Ws rules");
    writeFileSync(join(folder, "AGENTS.override.md"), "Local");
    expect(await readWorkspaceInstructions(folder, agentDir)).toMatchObject({
      content: "Ws rules",
      exists: true,
      overridden: true,
      inherited: [join(parent, "AGENTS.md")],
    });
  });

  test("saving creates a missing folder", async () => {
    const folder = join(root, "new", "ws");
    await saveWorkspaceInstructions(folder, "Rules");
    expect(readFileSync(join(folder, "AGENTS.md"), "utf8")).toBe("Rules");
  });
});
