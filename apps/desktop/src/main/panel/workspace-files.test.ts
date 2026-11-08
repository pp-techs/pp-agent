import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("electron", () => ({ dialog: {}, shell: {} }));
vi.mock("../i18n.ts", () => ({ translator: () => (key: string) => key }));

const { saveArtifact } = await import("./workspace-files.ts");

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
