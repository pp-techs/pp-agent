import { DEFAULT_BROWSER_PROFILE_ID } from "@workspace/shared";
import { describe, expect, it } from "vite-plus/test";

import {
  isProfileId,
  newProfileId,
  readBrowserProfiles,
  sortBrowserProfiles,
  validateImport,
  validateProfileName,
} from "./browser-profiles.ts";

describe("readBrowserProfiles", () => {
  it("always has the default profile", () => {
    expect(readBrowserProfiles(undefined).map((profile) => profile.id)).toEqual([
      DEFAULT_BROWSER_PROFILE_ID,
    ]);
  });

  it("drops entries that do not fit, one by one", () => {
    const profiles = readBrowserProfiles([
      { id: "bp-1", name: "Work", createdAt: 5, lastImport: null },
      { id: "bp-1", name: "Duplicate" },
      { id: "Has Spaces", name: "Bad id" },
      { id: "bp-2", name: "   " },
      "not an object",
      {
        id: "bp-3",
        name: "Shop",
        lastImport: { browser: "netscape", sourceProfile: "x", at: 1, count: 1 },
      },
    ]);
    expect(profiles.map((profile) => profile.id)).toEqual([
      DEFAULT_BROWSER_PROFILE_ID,
      "bp-1",
      "bp-3",
    ]);
    expect(profiles[2]).toMatchObject({ name: "Shop", createdAt: 0, lastImport: null });
  });

  it("keeps a valid import record", () => {
    const lastImport = { browser: "chrome", sourceProfile: "Person 1", at: 10, count: 42 };
    const [, profile] = readBrowserProfiles([{ id: "bp-1", name: "Work", lastImport }]);
    expect(profile.lastImport).toEqual(lastImport);
  });
});

describe("validateProfileName", () => {
  const profiles = readBrowserProfiles([{ id: "bp-1", name: "Work" }]);

  it("trims and accepts a new name", () => {
    expect(validateProfileName(profiles, { name: "  Shop  " })).toBe("Shop");
  });

  it("refuses an empty, too long or taken name", () => {
    expect(() => validateProfileName(profiles, { name: " " })).toThrow();
    expect(() => validateProfileName(profiles, { name: "x".repeat(41) })).toThrow();
    expect(() => validateProfileName(profiles, { name: "work" })).toThrow();
  });

  it("lets a profile keep its own name", () => {
    expect(validateProfileName(profiles, { id: "bp-1", name: "Work" })).toBe("Work");
  });
});

describe("ids", () => {
  it("are safe folder names", () => {
    expect(isProfileId("bp-1a2b3c4d")).toBe(true);
    expect(isProfileId("../etc")).toBe(false);
    expect(isProfileId("Upper")).toBe(false);
    expect(isProfileId("")).toBe(false);
  });

  it("are new and valid", () => {
    const profiles = readBrowserProfiles([]);
    const id = newProfileId(profiles);
    expect(isProfileId(id)).toBe(true);
    expect(profiles.some((profile) => profile.id === id)).toBe(false);
  });
});

it("sorts the default profile first, then by name", () => {
  const sorted = sortBrowserProfiles(
    readBrowserProfiles([
      { id: "bp-2", name: "Zalo" },
      { id: "bp-1", name: "Ads" },
    ]),
  );
  expect(sorted.map((profile) => profile.name)).toEqual(["Default", "Ads", "Zalo"]);
});

it("refuses an import record of an unknown browser", () => {
  expect(() =>
    validateImport({ browser: "netscape" as "chrome", sourceProfile: "x", at: 1, count: 1 }),
  ).toThrow();
});
