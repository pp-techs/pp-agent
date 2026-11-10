import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { listWorkspaceFolder, previewWorkspaceFile } from "./workspace-files.ts";

let root = "";
let outside = "";

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "pp-files-"));
  root = join(dir, "workspace");
  outside = join(dir, "outside");
  mkdirSync(root, { recursive: true });
  mkdirSync(outside, { recursive: true });
  mkdirSync(join(root, "docs"));
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, "b.md"), "# b");
  writeFileSync(join(root, "a.md"), "# a");
  writeFileSync(join(root, ".git", "config"), "[core]");
  writeFileSync(join(outside, "secret.txt"), "secret");
});

afterEach(() => rmSync(join(root, ".."), { recursive: true, force: true }));

describe("listWorkspaceFolder", () => {
  it("lists folders first, then files by name, without the version control folder", async () => {
    const entries = await listWorkspaceFolder(root, "", []);
    expect(entries.map((entry) => [entry.name, entry.kind])).toEqual([
      ["docs", "folder"],
      ["a.md", "file"],
      ["b.md", "file"],
    ]);
    expect(entries[2]?.path).toBe("b.md");
  });

  it("lists a folder below the workspace", async () => {
    writeFileSync(join(root, "docs", "note.txt"), "hi");
    const entries = await listWorkspaceFolder(root, "docs", []);
    expect(entries.map((entry) => entry.path)).toEqual(["docs/note.txt"]);
  });

  it("refuses a path that climbs out, and one that a link leads out through", async () => {
    await expect(listWorkspaceFolder(root, "../outside", [])).rejects.toThrow();
    symlinkSync(outside, join(root, "link"));
    await expect(listWorkspaceFolder(root, "link", [])).rejects.toThrow();
    await expect(previewWorkspaceFile(root, "link/secret.txt", [])).rejects.toThrow();
  });

  it("refuses a folder that is denied, even inside the workspace", async () => {
    await expect(listWorkspaceFolder(root, "", [join(root, "docs")])).resolves.toBeDefined();
    await expect(listWorkspaceFolder(root, "docs", [root])).rejects.toThrow();
  });
});

describe("previewWorkspaceFile", () => {
  it("reads a text file", async () => {
    expect(await previewWorkspaceFile(root, "a.md", [])).toEqual({
      kind: "text",
      text: "# a",
      truncated: false,
      size: 3,
    });
  });

  it("cuts a text file at 256 KiB and says so", async () => {
    await writeFile(join(root, "big.txt"), "x".repeat(300 * 1024));
    const preview = await previewWorkspaceFile(root, "big.txt", []);
    expect(preview.kind).toBe("text");
    if (preview.kind !== "text") return;
    expect(preview.truncated).toBe(true);
    expect(preview.text.length).toBe(256 * 1024);
  });

  it("shows a small image and refuses a binary file", async () => {
    writeFileSync(join(root, "dot.png"), Buffer.from("89504e470d0a1a0a", "hex"));
    expect((await previewWorkspaceFile(root, "dot.png", [])).kind).toBe("image");

    writeFileSync(join(root, "bin.dat"), Buffer.from([0, 1, 2]));
    expect((await previewWorkspaceFile(root, "bin.dat", [])).kind).toBe("none");
  });

  it("reports a file that is not there", async () => {
    await expect(previewWorkspaceFile(root, "gone.md", [])).rejects.toThrow();
  });
});
