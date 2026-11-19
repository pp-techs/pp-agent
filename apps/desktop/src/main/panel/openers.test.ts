import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("electron", () => ({ dialog: {} }));
vi.mock("../i18n.ts", () => ({ translator: () => (key: string) => key }));

const { Openers } = await import("./openers.ts");

describe("Openers", () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pp-openers-"));
    file = join(dir, "apps.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("lists the remembered apps that are still installed, named without the extension", async () => {
    const editor = join(dir, "Sublime Text.app");
    writeFileSync(editor, "");
    writeFileSync(file, JSON.stringify([join(dir, "Gone.app"), editor, 3]));
    expect(await new Openers(file).list()).toEqual([{ path: editor, name: "Sublime Text" }]);
  });

  it("refuses an app that was not chosen with the dialog", async () => {
    await expect(new Openers(file).open(join(dir, "a.txt"), "/bin/sh")).rejects.toThrow(
      "files.appGone",
    );
  });
});
