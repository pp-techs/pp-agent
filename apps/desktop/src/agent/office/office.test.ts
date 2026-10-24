import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { validateOfficeCall } from "./args.ts";
import { resolveInWorkspace } from "./files.ts";
import { officeCliEnv, platformKey, runOfficeCli } from "./run.ts";

let root: string;
let workspace: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pp-office-"));
  workspace = join(root, "ws");
  await mkdir(join(workspace, "sub"), { recursive: true });
  await mkdir(join(root, "outside"), { recursive: true });
  await writeFile(join(workspace, "report.docx"), "x");
  await writeFile(join(workspace, "logo.png"), "x");
  await writeFile(join(root, "outside", "secret.docx"), "x");
  await symlink(join(root, "outside"), join(workspace, "escape"), "dir").catch(() => undefined);
});

afterAll(() => rm(root, { recursive: true, force: true }));

describe("resolveInWorkspace", () => {
  test("accepts relative and absolute paths inside the workspace", async () => {
    expect((await resolveInWorkspace(workspace, "sub/new.docx")).display).toBe("sub/new.docx");
    expect((await resolveInWorkspace(workspace, join(workspace, "report.docx"))).display).toBe(
      "report.docx",
    );
  });

  test("refuses parent traversal, other folders, and empty paths", async () => {
    await expect(resolveInWorkspace(workspace, "../outside/secret.docx")).rejects.toThrow(
      /outside/,
    );
    await expect(
      resolveInWorkspace(workspace, join(root, "outside", "secret.docx")),
    ).rejects.toThrow(/outside/);
    await expect(resolveInWorkspace(workspace, "")).rejects.toThrow();
    await expect(resolveInWorkspace(workspace, "a\0b")).rejects.toThrow();
  });

  test("refuses a symbolic link that leads out of the workspace", async () => {
    await expect(resolveInWorkspace(workspace, "escape/secret.docx")).rejects.toThrow(/outside/);
    await expect(resolveInWorkspace(workspace, "escape/new.docx")).rejects.toThrow(/outside/);
  });
});

describe("validateOfficeCall", () => {
  test("builds argv with absolute file paths", async () => {
    const call = await validateOfficeCall("read", workspace, "view", "report.docx", ["outline"]);
    expect(call.argv).toEqual(["view", join(workspace, "report.docx"), "outline"]);
  });

  test("keeps the tools apart: reading cannot change, editing cannot run read-only views", async () => {
    await expect(
      validateOfficeCall("read", workspace, "set", "report.docx", ["/body/p[1]"]),
    ).rejects.toThrow(/office_edit/);
    await expect(
      validateOfficeCall("edit", workspace, "get", "report.docx", ["/"]),
    ).rejects.toThrow(/not available/);
  });

  test("refuses commands that install, update, serve, or reach outside", async () => {
    for (const command of [
      "install",
      "skills",
      "mcp",
      "watch",
      "unwatch",
      "open",
      "close",
      "save",
      "plugins",
      "refresh",
      "dump-all",
    ]) {
      await expect(
        validateOfficeCall("edit", workspace, command, "report.docx", []),
      ).rejects.toThrow(/not available/);
      await expect(
        validateOfficeCall("read", workspace, command, "report.docx", []),
      ).rejects.toThrow(/not available/);
    }
  });

  test("requires an Office file inside the workspace", async () => {
    await expect(
      validateOfficeCall("read", workspace, "view", "../outside/secret.docx", ["text"]),
    ).rejects.toThrow(/outside/);
    await expect(
      validateOfficeCall("read", workspace, "view", "logo.png", ["text"]),
    ).rejects.toThrow(/expected a/);
    await expect(
      validateOfficeCall("read", workspace, "view", "missing.docx", ["text"]),
    ).rejects.toThrow(/does not exist/);
    await expect(
      validateOfficeCall("read", workspace, "view", undefined, ["text"]),
    ).rejects.toThrow(/needs a file/);
  });

  test("create accepts a new file in a new folder and returns it as an output", async () => {
    const call = await validateOfficeCall("edit", workspace, "create", "new/deck.pptx", []);
    expect(call.outputs).toEqual([join(workspace, "new", "deck.pptx")]);
    await expect(validateOfficeCall("edit", workspace, "create", "../x.pptx", [])).rejects.toThrow(
      /outside/,
    );
  });

  test("rejects options that are not in the table for the command", async () => {
    await expect(
      validateOfficeCall("edit", workspace, "add", "report.docx", ["/body", "--port", "80"]),
    ).rejects.toThrow(/not allowed/);
    await expect(
      validateOfficeCall("read", workspace, "view", "report.docx", ["text", "--browser"]),
    ).rejects.toThrow(/not allowed/);
    await expect(
      validateOfficeCall("edit", workspace, "set", "report.docx", ["/", "--force"]),
    ).rejects.toThrow(/not allowed/);
  });

  test("checks the number of positional arguments", async () => {
    await expect(validateOfficeCall("edit", workspace, "add", "report.docx", [])).rejects.toThrow(
      /needs 1/,
    );
    await expect(
      validateOfficeCall("read", workspace, "view", "report.docx", ["text", "extra"]),
    ).rejects.toThrow(/Unexpected/);
  });

  test("confines file-valued properties", async () => {
    const add = (value: string) =>
      validateOfficeCall("edit", workspace, "add", "report.docx", [
        "/body",
        "--type",
        "picture",
        "--prop",
        value,
      ]);
    await expect(add("src=logo.png")).resolves.toBeDefined();
    await expect(add(`src=${join(workspace, "sub", "a.png")}`)).resolves.toBeDefined();
    await expect(add("src=../outside/secret.docx")).rejects.toThrow(/outside/);
    await expect(add("src=/etc/passwd")).rejects.toThrow(/outside/);
    await expect(add("path=/etc/passwd")).rejects.toThrow(/outside/);
    await expect(add("src=https://example.com/a.png")).rejects.toThrow(/not allowed/);
    await expect(add("src=file:///etc/passwd")).rejects.toThrow(/not allowed/);
    await expect(add("src=//server/share/a.png")).rejects.toThrow(/not allowed/);
    await expect(add("src=~/a.png")).rejects.toThrow(/inside the workspace/);
    await expect(add("src=escape/secret.docx")).rejects.toThrow(/outside/);
    await expect(add("src=data:image/png;base64,AAAA")).resolves.toBeDefined();
    await expect(add("image=/etc/hosts")).rejects.toThrow(/outside/);
    // Not file-valued: free text is left alone.
    await expect(add("text=see /etc/passwd")).resolves.toBeDefined();
    await expect(add("noequals")).rejects.toThrow(/key=value/);
  });

  test("accepts inline table data and refuses links in it", async () => {
    const add = (value: string) =>
      validateOfficeCall("edit", workspace, "add", "report.docx", [
        "/body",
        "--type",
        "table",
        "--prop",
        value,
      ]);
    await expect(add("data=A,B;1,2")).resolves.toBeDefined();
    await expect(add("data=Sales:1,2,3")).resolves.toBeDefined();
    await expect(add("data=https://example.com/a.csv")).rejects.toThrow(/not allowed/);
    await expect(add("data=../outside/a.csv")).rejects.toThrow(/outside/);
  });

  test("view in office_edit needs --out inside the workspace; office_read cannot write", async () => {
    await expect(
      validateOfficeCall("edit", workspace, "view", "report.docx", ["html"]),
    ).rejects.toThrow(/--out/);
    await expect(
      validateOfficeCall("edit", workspace, "view", "report.docx", ["text"]),
    ).rejects.toThrow(/office_read/);
    await expect(
      validateOfficeCall("edit", workspace, "view", "report.docx", [
        "html",
        "--out",
        "../outside/o.html",
      ]),
    ).rejects.toThrow(/outside/);
    const ok = await validateOfficeCall("edit", workspace, "view", "report.docx", [
      "screenshot",
      "-o",
      "shots/p.png",
    ]);
    expect(ok.outputs).toEqual([join(workspace, "shots", "p.png")]);
    await expect(
      validateOfficeCall("read", workspace, "view", "report.docx", ["text", "-o", "x.txt"]),
    ).rejects.toThrow(/cannot write/);
    await expect(
      validateOfficeCall("read", workspace, "view", "report.docx", ["screenshot"]),
    ).rejects.toThrow(/not available in office_read/);
  });

  test("batch is validated item by item and sent on standard input", async () => {
    const batch = (items: unknown) =>
      validateOfficeCall("edit", workspace, "batch", "report.docx", [
        "--commands",
        JSON.stringify(items),
      ]);
    const ok = await batch([
      { command: "add", parent: "/body", type: "paragraph", props: { text: "Hi" } },
    ]);
    expect(ok.batchJson).toBe(
      JSON.stringify([
        { command: "add", parent: "/body", type: "paragraph", props: { text: "Hi" } },
      ]),
    );
    expect(ok.argv).toEqual(["batch", join(workspace, "report.docx")]);
    await expect(batch([{ command: "watch" }])).rejects.toThrow(/command/);
    await expect(batch([{ command: "add", exec: "rm" }])).rejects.toThrow(/unknown field/);
    await expect(
      batch([{ command: "add", parent: "/body", type: "picture", props: { src: "/etc/passwd" } }]),
    ).rejects.toThrow(/outside/);
    await expect(batch({ command: "add" })).rejects.toThrow(/array/);
    await expect(validateOfficeCall("edit", workspace, "batch", "report.docx", [])).rejects.toThrow(
      /--commands/,
    );
    await expect(
      validateOfficeCall("edit", workspace, "batch", "report.docx", ["--commands", "not json"]),
    ).rejects.toThrow(/JSON array/);
  });

  test("import and merge only touch workspace files", async () => {
    await writeFile(join(workspace, "data.csv"), "a,b");
    await writeFile(join(workspace, "sheet.xlsx"), "x");
    const imported = await validateOfficeCall("edit", workspace, "import", "sheet.xlsx", [
      "/Sheet1",
      "data.csv",
    ]);
    expect(imported.argv).toEqual([
      "import",
      join(workspace, "sheet.xlsx"),
      "/Sheet1",
      join(workspace, "data.csv"),
    ]);
    await expect(
      validateOfficeCall("edit", workspace, "import", "sheet.xlsx", ["/Sheet1", "/etc/passwd"]),
    ).rejects.toThrow(/outside/);
    await expect(
      validateOfficeCall("edit", workspace, "import", "sheet.xlsx", [
        "/Sheet1",
        "--file",
        "../x.csv",
      ]),
    ).rejects.toThrow(/outside/);
    await expect(
      validateOfficeCall("edit", workspace, "merge", "report.docx", [
        "../out.docx",
        "--data",
        "{}",
      ]),
    ).rejects.toThrow(/outside/);
    await expect(
      validateOfficeCall("edit", workspace, "merge", "report.docx", [
        "merged.docx",
        "--data",
        "../data.json",
      ]),
    ).rejects.toThrow(/outside/);
    const merged = await validateOfficeCall("edit", workspace, "merge", "report.docx", [
      "merged.docx",
      "--data",
      '{"a":"b"}',
    ]);
    expect(merged.outputs).toEqual([join(workspace, "merged.docx")]);
  });

  test("help and load_skill need no file", async () => {
    expect((await validateOfficeCall("read", workspace, "help", undefined, ["docx"])).argv).toEqual(
      ["help", "docx"],
    );
    await expect(validateOfficeCall("read", workspace, "help", "report.docx", [])).rejects.toThrow(
      /takes no file/,
    );
    const skill = await validateOfficeCall("read", workspace, "load_skill", undefined, [
      "pitch-deck",
      "--path",
      "reference/a.md",
    ]);
    expect(skill.argv[0]).toBe("load_skill");
  });
});

describe("officeCliEnv", () => {
  test("drops secrets and proxies, and turns updates and background processes off", () => {
    const env = officeCliEnv("/home/x", {
      PATH: "/usr/bin",
      OPENAI_API_KEY: "sk-secret",
      HTTPS_PROXY: "http://proxy",
      HOME: "/Users/real",
      GITHUB_TOKEN: "t",
    });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/x");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.HTTPS_PROXY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.OFFICECLI_SKIP_UPDATE).toBe("1");
    expect(env.OFFICECLI_NO_AUTO_INSTALL).toBe("1");
    expect(env.OFFICECLI_NO_AUTO_RESIDENT).toBe("1");
  });

  test("names the platform folder like electron-builder", () => {
    expect(platformKey("darwin", "arm64")).toBe("mac-arm64");
    expect(platformKey("win32", "x64")).toBe("win-x64");
    expect(platformKey("linux", "arm64")).toBe("linux-arm64");
  });
});

describe("runOfficeCli", () => {
  // Node stands in for the binary: it prints what the command would have seen.
  const node = { binary: process.execPath, cwd: "", homeDir: "" };

  beforeAll(() => {
    node.cwd = workspace;
    node.homeDir = join(root, "home");
  });

  test("runs without a shell, in the workspace, with the scrubbed environment", async () => {
    const result = await runOfficeCli({
      ...node,
      argv: [
        "-e",
        "console.log(JSON.stringify([process.cwd() === process.argv[1], process.env.SECRET ?? null, process.env.OFFICECLI_SKIP_UPDATE]))",
        "$(echo injected)",
      ],
      baseEnv: { PATH: process.env.PATH, SECRET: "x" },
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('"1"');
    expect(result.output).not.toContain('"x"');
  });

  test("reports the exit code and stops when the run is aborted", async () => {
    const failed = await runOfficeCli({ ...node, argv: ["-e", "process.exit(3)"] });
    expect(failed.exitCode).toBe(3);

    const controller = new AbortController();
    const pending = runOfficeCli({
      ...node,
      argv: ["-e", "setTimeout(() => {}, 60000)"],
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    await expect(pending).rejects.toThrow(/Stopped/);
  });

  test("cuts off very large output", async () => {
    const result = await runOfficeCli({
      ...node,
      argv: ["-e", "for (let i = 0; i < 400; i++) process.stdout.write('x'.repeat(100000))"],
    });
    expect(result.output.length).toBeLessThan(3 * 1024 * 1024);
    expect(result.output).toContain("[Output cut off at 2 MB.]");
  });
});
