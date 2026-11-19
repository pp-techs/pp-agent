import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("electron", () => ({ dialog: {}, shell: {} }));
vi.mock("../i18n.ts", () => ({ translator: () => (key: string) => key }));

const { saveArtifact, searchEntries } = await import("./workspace-files.ts");

describe("saveArtifact", () => {
  let base: string;
  let root: string;
  const now = new Date(2026, 10, 8, 14, 23, 5);
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "pp-artifact-save-"));
    root = join(base, "workspace");
    mkdirSync(root);
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("saves into the artifacts folder, creating it", async () => {
    const path = await saveArtifact(root, "<p>hi</p>", now);
    expect(path).toBe("artifacts/preview-2026-11-08-142305.html");
    expect(readFileSync(join(root, path), "utf8")).toBe("<p>hi</p>");
  });

  it("never replaces an earlier preview saved in the same second", async () => {
    const first = await saveArtifact(root, "one", now);
    const second = await saveArtifact(root, "two", now);
    expect(second).toBe("artifacts/preview-2026-11-08-142305-2.html");
    expect(readFileSync(join(root, first), "utf8")).toBe("one");
    expect(readFileSync(join(root, second), "utf8")).toBe("two");
  });

  it("refuses a preview larger than the panel shows", async () => {
    await expect(saveArtifact(root, "x".repeat(256 * 1024 + 1), now)).rejects.toThrow(
      "panel.files.artifactTooLarge",
    );
  });

  it.each([42, "", "   "])("refuses %j as content", async (html) => {
    await expect(saveArtifact(root, html, now)).rejects.toThrow("panel.files.invalidArtifact");
  });

  it.skipIf(process.platform === "win32")(
    "refuses an artifacts link that leads out of the workspace",
    async () => {
      const outside = join(base, "outside");
      mkdirSync(outside);
      symlinkSync(outside, join(root, "artifacts"));
      await expect(saveArtifact(root, "<p>hi</p>", now)).rejects.toThrow(
        "panel.files.outsideWorkspace",
      );
      expect(readdirSync(outside)).toEqual([]);
    },
  );
});

describe("searchEntries", () => {
  let base: string;
  let root: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "pp-search-"));
    root = join(base, "workspace");
    mkdirSync(join(root, "src", "util"), { recursive: true });
    mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
    mkdirSync(join(base, "outside"));
    writeFileSync(join(root, "src", "util", "parser.ts"), "");
    writeFileSync(join(root, "src", "Parser-notes.md"), "");
    writeFileSync(join(root, "src", "util", "other.ts"), "");
    writeFileSync(join(root, "node_modules", "dep", "parser.js"), "");
    writeFileSync(join(base, "outside", "parser.txt"), "");
    symlinkSync(join(base, "outside"), join(root, "linked"));
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("matches every word in any case, shortest paths first, skipping dependencies and links", async () => {
    const found = await searchEntries(root, "PARSER");
    expect(found.map((entry) => entry.path)).toEqual(["src/util/parser.ts", "src/Parser-notes.md"]);
    expect((await searchEntries(root, "util ts")).map((entry) => entry.path)).toEqual([
      "src/util/other.ts",
      "src/util/parser.ts",
    ]);
  });

  it("finds nothing for an empty query", async () => {
    expect(await searchEntries(root, "  ")).toEqual([]);
  });
});
