import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const openPath = vi.hoisted(() => vi.fn(async () => ""));
vi.mock("electron", () => ({ dialog: {}, shell: { openPath } }));
vi.mock("./i18n.ts", () => ({ translator: () => (key: string) => key }));

const { openFolder } = await import("./files.ts");

describe("openFolder", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pp-open-folder-"));
    openPath.mockClear();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("opens a workspace folder", async () => {
    const dir = join(root, "Project");
    mkdirSync(dir);
    await openFolder(dir, [dir], "darwin");
    expect(openPath).toHaveBeenCalledOnce();
  });

  it("refuses a folder that is not a workspace", async () => {
    const dir = join(root, "Elsewhere");
    mkdirSync(dir);
    await expect(openFolder(dir, [join(root, "Project")], "darwin")).rejects.toThrow(
      "app.folderCannotOpen",
    );
    expect(openPath).not.toHaveBeenCalled();
  });

  it.each(["Tool.app", "Run.workflow", "Setup.pkg", "Helper.bundle"])(
    "refuses the macOS bundle %s, which Finder would run",
    async (name) => {
      const dir = join(root, name);
      mkdirSync(dir);
      await expect(openFolder(dir, [dir], "darwin")).rejects.toThrow("app.folderCannotOpen");
      expect(openPath).not.toHaveBeenCalled();
    },
  );

  it("refuses a workspace that is a link to a bundle", async () => {
    const bundle = join(root, "Tool.app");
    const link = join(root, "Project");
    mkdirSync(bundle);
    symlinkSync(bundle, link, "dir");
    await expect(openFolder(link, [link], "darwin")).rejects.toThrow("app.folderCannotOpen");
    expect(openPath).not.toHaveBeenCalled();
  });

  it("opens a folder named like a bundle on other systems", async () => {
    const dir = join(root, "notes.app");
    mkdirSync(dir);
    await openFolder(dir, [dir], "win32");
    expect(openPath).toHaveBeenCalledOnce();
  });
});
