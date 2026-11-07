import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppSettings } from "@workspace/shared";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { BROWSER_TOOL, browserActionTier } from "./browser-tool.ts";
import { deniedFolders, pathAccess, type PathRules } from "./path-access.ts";
import { delegatedTools } from "./subagent.ts";
import { callRule, SHELL_TOOL, toolTier } from "./tools.ts";

const settings = (patch: Partial<AppSettings> = {}) =>
  ({ toolPolicies: {}, shellEnabled: true, yoloMode: false, ...patch }) as unknown as AppSettings;

describe("file reads are rated by where they reach", () => {
  let root: string;
  let workspace: string;
  let appHome: string;
  let rules: PathRules;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pp-gate-"));
    workspace = join(root, "workspace");
    appHome = join(root, "app");
    mkdirSync(join(workspace, "docs"), { recursive: true });
    mkdirSync(join(appHome, "agent", "skills", "report"), { recursive: true });
    mkdirSync(join(root, "elsewhere"));
    writeFileSync(join(workspace, "docs", "a.txt"), "a");
    writeFileSync(join(appHome, "vault.key"), "secret");
    writeFileSync(join(appHome, "agent", "skills", "report", "SKILL.md"), "skill");
    writeFileSync(join(root, "elsewhere", "b.txt"), "b");
    rules = { trusted: [join(appHome, "agent", "skills")], denied: deniedFolders(appHome) };
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test("inside the workspace, relative or absolute", async () => {
    expect((await pathAccess("read", { path: "docs/a.txt" }, workspace, rules))?.access).toBe(
      "inside",
    );
    expect(
      (
        await pathAccess(
          "read_document",
          { path: join(workspace, "docs", "a.txt") },
          workspace,
          rules,
        )
      )?.access,
    ).toBe("inside");
    expect((await pathAccess("ls", {}, workspace, rules))?.access).toBe("inside");
    expect((await pathAccess("grep", { pattern: "x" }, workspace, rules))?.access).toBe("inside");
  });

  test("outside the workspace, including through `..` and a symbolic link", async () => {
    expect(
      (await pathAccess("read", { path: "../elsewhere/b.txt" }, workspace, rules))?.access,
    ).toBe("outside");
    symlinkSync(join(root, "elsewhere"), join(workspace, "link"), "junction");
    expect((await pathAccess("read", { path: "link/b.txt" }, workspace, rules))?.access).toBe(
      "outside",
    );
    expect((await pathAccess("find", { path: root }, workspace, rules))?.access).toBe("denied");
    expect(
      (await pathAccess("find", { path: join(root, "elsewhere") }, workspace, rules))?.access,
    ).toBe("outside");
  });

  test("the app's folder and ~/.ssh are denied, the installed skills are not", async () => {
    expect(
      (await pathAccess("read", { path: join(appHome, "vault.key") }, workspace, rules))?.access,
    ).toBe("denied");
    expect(
      (await pathAccess("read", { path: "~/.ssh/id_ed25519" }, workspace, rules))?.access,
    ).toBe("denied");
    expect(
      (await pathAccess("read", { path: `@${appHome}/vault.key` }, workspace, rules))?.access,
    ).toBe("denied");
    expect(
      (
        await pathAccess(
          "read",
          { path: join(appHome, "agent", "skills", "report", "SKILL.md") },
          workspace,
          rules,
        )
      )?.access,
    ).toBe("inside");
    // A search of a folder that holds the app's folder would read it too.
    expect(
      (await pathAccess("grep", { pattern: "key", path: root }, workspace, rules))?.access,
    ).toBe("denied");
    // A symbolic link in the workspace cannot reach it either.
    symlinkSync(appHome, join(workspace, "app-link"), "junction");
    expect(
      (await pathAccess("read", { path: "app-link/vault.key" }, workspace, rules))?.access,
    ).toBe("denied");
  });

  test("tools that do not read files by path are not rated", async () => {
    expect(
      await pathAccess("web_fetch", { url: "https://example.com" }, workspace, rules),
    ).toBeNull();
  });
});

describe("callRule", () => {
  const inside = { access: "inside" as const, path: "/w/a.txt" };
  const outside = { access: "outside" as const, path: "/etc/hosts" };
  const denied = { access: "denied" as const, path: "/home/me/.ssh/id_rsa" };

  test("a read inside the workspace runs, outside it asks, a denied folder is refused", () => {
    expect(callRule("read", "read", settings(), { path: inside }).effective).toBe("allow");
    expect(callRule("read", "read", settings(), { path: outside }).effective).toBe("ask");
    expect(
      callRule("read", "read", settings({ toolPolicies: { read: "allow" } }), { path: outside })
        .effective,
    ).toBe("ask");
    expect(callRule("read", "read", settings(), { path: denied }).effective).toBe("off");
  });

  test("yolo mode reads outside the workspace but never a denied folder", () => {
    expect(
      callRule("read", "read", settings({ yoloMode: true }), { path: outside }).effective,
    ).toBe("allow");
    expect(callRule("read", "read", settings({ yoloMode: true }), { path: denied }).effective).toBe(
      "off",
    );
  });

  test("a chat other people talk in asks the owner before tools, even in yolo mode", () => {
    const yolo = settings({ yoloMode: true, toolPolicies: { [SHELL_TOOL]: "allow" } });
    expect(callRule("read", "read", settings(), { path: inside, chat: "members" }).effective).toBe(
      "ask",
    );
    expect(callRule("web_fetch", "read", yolo, { chat: "members" }).effective).toBe("ask");
    expect(callRule(SHELL_TOOL, "exec", yolo, { chat: "members" }).effective).toBe("ask");
    // Discovery tools stay on; tools that only touch the chat run.
    expect(callRule("tool_search", "read", settings(), { chat: "members" }).effective).toBe(
      "allow",
    );
    expect(callRule("todo_write", "read", settings(), { chat: "members" }).effective).toBe("allow");
    // The owner's own chat follows the usual rules.
    expect(callRule("web_fetch", "read", settings(), { chat: "owner" }).effective).toBe("allow");
  });

  test("with nobody paired, a members chat cannot run tools", () => {
    const rule = callRule("read", "read", settings(), { path: inside, chat: "unpaired" });
    expect(rule.effective).toBe("off");
    expect(rule.reason).toContain("nobody is paired");
  });
});

describe("tiers", () => {
  test("the browser looks freely but asks before it acts", () => {
    for (const action of ["tabs", "snapshot", "text", "screenshot", "scroll", "wait"])
      expect(browserActionTier(action)).toBe("read");
    for (const action of ["open", "navigate", "click", "type", "press", "select_option", "eval"])
      expect(browserActionTier(action)).toBe("write");
    expect(callRule(BROWSER_TOOL, browserActionTier("click"), settings()).effective).toBe("ask");
    expect(callRule(BROWSER_TOOL, browserActionTier("snapshot"), settings()).effective).toBe(
      "allow",
    );
  });

  test("an MCP server's read-only label counts only for a trusted server", () => {
    const readOnly = { readOnlyHint: true };
    expect(toolTier("mcp__mail__send_email", readOnly)).toBe("write");
    expect(toolTier("mcp__mail__send_email", readOnly, (server) => server === "crm")).toBe("write");
    expect(toolTier("mcp__crm__find", readOnly, (server) => server === "crm")).toBe("read");
    expect(toolTier("mcp__crm__update", {}, (server) => server === "crm")).toBe("write");
  });
});

describe("delegate_task", () => {
  test("a helper under a named agent gets only tools the caller may hand out", () => {
    expect(delegatedTools(["read", "web_fetch", "grep"], ["read", "grep"])).toEqual([
      "read",
      "grep",
    ]);
    expect(delegatedTools(["read", "web_fetch"], [])).toEqual([]);
  });
});
