/**
 * The report files: one folder per run under `research/`, the run's own files replaced on later
 * saves, and nothing written through a link that leads out of the workspace.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResearchState } from "./research.ts";
import { reportNames, writeReport } from "./research.ts";
import { afterEach, expect, test } from "vite-plus/test";

const folders: string[] = [];

function state(fields: Partial<ResearchState> = {}): ResearchState {
  return {
    question: "How fast is solar growing?",
    depth: "quick",
    status: "active",
    phase: "writing",
    stalled: false,
    turns: 1,
    visited: [],
    sources: [],
    report: null,
    htmlSaved: false,
    ownedFiles: [],
    ...fields,
  };
}

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pp-research-files-"));
  folders.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("names a folder per run, and takes the next folder when it is busy", () => {
  const now = new Date(2026, 10, 10);
  expect(reportNames("How fast is solar growing?", now, () => false)).toEqual({
    markdown: "research/how-fast-is-solar-growing-2026-11-10/report.md",
    html: "research/how-fast-is-solar-growing-2026-11-10/report.html",
  });
  expect(
    reportNames("How fast is solar growing?", now, (folder) => folder.endsWith("-2026-11-10")),
  ).toEqual({
    markdown: "research/how-fast-is-solar-growing-2026-11-10-2/report.md",
    html: "research/how-fast-is-solar-growing-2026-11-10-2/report.html",
  });
});

test("writes both files into the run's folder, and a later save reuses it", async () => {
  const dir = await workspace();
  const run = state();
  const first = writeReport(dir, run, "# Report", "<html>report</html>");
  expect(first.markdown).toMatch(/^research\/[^/]+\/report\.md$/);
  expect(readFileSync(join(dir, first.markdown), "utf8")).toBe("# Report");
  expect(readFileSync(join(dir, first.html ?? ""), "utf8")).toBe("<html>report</html>");
  expect(run.report).toEqual(first);

  const second = writeReport(dir, run, "# Report, final", "<html>final</html>");
  expect(second).toEqual(first);
  expect(readFileSync(join(dir, second.markdown), "utf8")).toBe("# Report, final");
});

test.skipIf(process.platform === "win32")(
  "refuses a run folder that is a link leading out of the workspace",
  async () => {
    const dir = await workspace();
    const outside = mkdtempSync(join(tmpdir(), "pp-research-outside-"));
    folders.push(outside);
    const research = join(dir, "research");
    mkdirSync(research, { recursive: true });
    await symlink(outside, join(research, "run"), "dir");

    expect(() =>
      writeReport(
        dir,
        state({ report: { markdown: "research/run/report.md", html: "research/run/report.html" } }),
        "# Report",
        null,
      ),
    ).toThrow(/not inside the workspace/);
  },
);
