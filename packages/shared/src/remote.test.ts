import { describe, expect, test } from "vite-plus/test";
import { type AgentCommand, REMOTE_LOCAL_ONLY_COMMANDS, remoteMayRun } from "./index.ts";

const app = { id: "com.apple.mail", name: "Mail" };

describe("remoteMayRun", () => {
  test.each([...REMOTE_LOCAL_ONLY_COMMANDS])("refuses %s", (type) => {
    expect(remoteMayRun({ type } as AgentCommand)).toBe(false);
  });

  test("Telegram and Zalo set-up, bulk deletions and the login service are computer-only", () => {
    for (const type of [
      "save_telegram",
      "start_telegram_pairing",
      "forget_telegram",
      "save_zalo",
      "start_zalo_pairing",
      "forget_zalo",
      "delete_workspace",
      "clear_sessions",
      "clear_memory",
      "set_service_installed",
    ])
      expect(REMOTE_LOCAL_ONLY_COMMANDS).toContain(type);
  });

  test("an approval may be remembered for the conversation, not always", () => {
    const answer = (remember?: "conversation" | "always"): AgentCommand => ({
      type: "respond_approval",
      requestId: "r",
      approved: true,
      ...(remember ? { remember } : {}),
    });
    expect(remoteMayRun(answer())).toBe(true);
    expect(remoteMayRun(answer("conversation"))).toBe(true);
    expect(remoteMayRun(answer("always"))).toBe(false);
  });

  test("apps may be blocked or cleared from a device, never always allowed", () => {
    const access = (value: "allowed" | "blocked" | null): AgentCommand => ({
      type: "set_computer_app_access",
      app,
      access: value,
    });
    expect(remoteMayRun(access("allowed"))).toBe(false);
    expect(remoteMayRun(access("blocked"))).toBe(true);
    expect(remoteMayRun(access(null))).toBe(true);
  });

  test("a device edits workspaces but does not create one", () => {
    const workspace = { name: "W", icon: "📁", dir: "/Users/x", agentId: null };
    expect(remoteMayRun({ type: "save_workspace", workspace })).toBe(false);
    expect(remoteMayRun({ type: "save_workspace", workspace: { ...workspace, id: "w" } })).toBe(
      true,
    );
  });

  test("workspace skills can be distrusted from a device, not trusted", () => {
    expect(remoteMayRun({ type: "set_workspace_skills_trust", id: "w", trusted: true })).toBe(
      false,
    );
    expect(remoteMayRun({ type: "set_workspace_skills_trust", id: "w", trusted: false })).toBe(
      true,
    );
  });

  test("the shell and yolo mode can be turned off, not on", () => {
    expect(remoteMayRun({ type: "update_settings", patch: { shellEnabled: true } })).toBe(false);
    expect(remoteMayRun({ type: "update_settings", patch: { yoloMode: true } })).toBe(false);
    expect(remoteMayRun({ type: "update_settings", patch: { shellEnabled: false } })).toBe(true);
    expect(remoteMayRun({ type: "set_conversation_yolo", active: true } as AgentCommand)).toBe(
      false,
    );
  });
});
