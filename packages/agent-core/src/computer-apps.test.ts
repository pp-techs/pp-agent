import { describe, expect, it } from "vite-plus/test";

import { computerAppAccess, readComputerApps, withAccess } from "./computer-apps.ts";

const notes = { id: "com.apple.Notes", name: "Notes" };
const excel = { id: "com.microsoft.Excel", name: "Microsoft Excel" };

describe("readComputerApps", () => {
  it("drops malformed entries and keeps an app on both lists as blocked only", () => {
    expect(
      readComputerApps({
        allowed: [notes, { id: "" }, { id: 3, name: "x" }, excel, notes],
        blocked: [excel],
      }),
    ).toEqual({ allowed: [notes], blocked: [excel] });
    expect(readComputerApps("nope")).toEqual({ allowed: [], blocked: [] });
  });
});

describe("withAccess", () => {
  it("moves an app between the lists, newest last", () => {
    const allowed = withAccess({ allowed: [excel], blocked: [notes] }, notes, "allowed");
    expect(allowed).toEqual({ allowed: [excel, notes], blocked: [] });
    expect(withAccess(allowed, notes, null)).toEqual({ allowed: [excel], blocked: [] });
    expect(withAccess(allowed, excel, "blocked")).toEqual({ allowed: [notes], blocked: [excel] });
  });

  it("never allows a protected app", () => {
    const terminal = { id: "com.apple.Terminal", name: "Terminal" };
    expect(() => withAccess({ allowed: [], blocked: [] }, terminal, "allowed")).toThrow();
    expect(withAccess({ allowed: [], blocked: [] }, terminal, "blocked").blocked).toEqual([
      terminal,
    ]);
  });
});

describe("computerAppAccess", () => {
  const names = new Map([[excel.id, excel.name]]);
  const access = (value: unknown, conversation: string[] = []) =>
    computerAppAccess(
      value,
      { allowed: [notes], blocked: [{ id: "com.tinyspeck.slackmacgap", name: "Slack" }] },
      new Set(conversation),
      (id) => names.get(id),
    );

  it("needs no app approval without an app", () => {
    expect(access(undefined)).toEqual({ kind: "allowed" });
  });

  it("lets apps allowed always or for the conversation through", () => {
    expect(access(" com.apple.Notes ")).toEqual({ kind: "allowed" });
    expect(access(excel.id, [excel.id])).toEqual({ kind: "allowed" });
  });

  it("asks about a new app by the name the tool saw", () => {
    expect(access(excel.id)).toEqual({ kind: "ask", app: excel });
    expect(access("com.example.Unknown")).toEqual({
      kind: "ask",
      app: { id: "com.example.Unknown", name: "com.example.Unknown" },
    });
  });

  it("refuses blocked and protected apps even when the conversation allowed them", () => {
    expect(access("com.tinyspeck.slackmacgap", ["com.tinyspeck.slackmacgap"]).kind).toBe("refused");
    expect(access("com.pptechs.agent").kind).toBe("refused");
    expect(access("com.mitchellh.ghostty").kind).toBe("refused");
  });
});
