import { describe, expect, test } from "vite-plus/test";

import {
  zaloAllowedUsers,
  zaloChatId,
  zaloChatSettings,
  type ZaloChatDraft,
} from "./zalo-chat-fields";

const draft: ZaloChatDraft = {
  chatId: "zgr-88c9f66a0b05e25bbb14",
  label: "Team",
  access: "members",
  busyMode: "queue",
  allowedUsers: "u42, u43",
};

describe("Zalo chat fields", () => {
  test("accepts opaque Zalo chat ids without discovery", () => {
    expect(zaloChatId(" u42 ")).toBe("u42");
    expect(zaloChatId(draft.chatId)).toBe("zgr-88c9f66a0b05e25bbb14");
    expect(zaloChatSettings(undefined, draft, ["u42", "u43"])).toEqual({
      label: "Team",
      access: "members",
      busyMode: "queue",
      allowedUsers: ["u42", "u43"],
    });
  });

  test("rejects empty and whitespace-containing chat ids", () => {
    for (const value of ["", "   ", "u 42", "u42\tu43"]) {
      expect(zaloChatId(value)).toBeNull();
    }
  });

  test("clears the label and allowlist while retaining unrelated chat settings", () => {
    const existing = {
      label: "Old label",
      allowedUsers: ["u42"],
      agentId: "finance",
      workspaceId: "reports",
      access: "members" as const,
      busyMode: "steer" as const,
    };
    const cleared = { ...draft, label: "", allowedUsers: "", busyMode: "steer" as const };
    expect(zaloChatSettings(existing, cleared, zaloAllowedUsers("")!)).toEqual({
      ...existing,
      label: "",
      allowedUsers: [],
    });
  });

  test("accepts an empty allowlist and deduplicates valid user ids", () => {
    expect(zaloAllowedUsers("   ")).toEqual([]);
    expect(zaloAllowedUsers("u42, u43, u42")).toEqual(["u42", "u43"]);
  });

  test("never drops invalid allowlist entries and accidentally permits everyone", () => {
    for (const value of ["u42, u 43", "u42,", ", u43"]) {
      expect(zaloAllowedUsers(value)).toBeNull();
    }
  });
});
