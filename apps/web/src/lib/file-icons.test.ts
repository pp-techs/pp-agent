import icons from "@iconify-json/vscode-icons/icons.json" with { type: "json" };
import { describe, expect, test } from "vite-plus/test";
import {
  FILE_EXTENSIONS,
  FILE_NAMES,
  FOLDER_NAMES,
  fileIconName,
  folderIconName,
} from "./file-icons.ts";

const known = new Set([...Object.keys(icons.icons), ...Object.keys(icons.aliases ?? {})]);

describe("file icons", () => {
  test("picks by whole name, then extension, then the default", () => {
    expect(fileIconName("package.json")).toBe("file-type-npm");
    expect(fileIconName("Dockerfile")).toBe("file-type-docker");
    expect(fileIconName("App.test.TSX")).toBe("file-type-reactts");
    expect(fileIconName(".env.local")).toBe("file-type-dotenv");
    expect(fileIconName("notes.unknownext")).toBe("default-file");
    expect(fileIconName("noextension")).toBe("default-file");
    // Names the tables inherit from Object are not entries.
    expect(fileIconName("constructor")).toBe("default-file");
    expect(fileIconName("x.toString")).toBe("default-file");
    expect(fileIconName(".environment.ts")).toBe("file-type-typescript");
    expect(folderIconName("__proto__", false)).toBe("default-folder");
  });

  test("folders by name, shut or open, else the default", () => {
    expect(folderIconName("src", false)).toBe("folder-type-src");
    expect(folderIconName("Node_Modules", true)).toBe("folder-type-node-opened");
    expect(folderIconName("whatever", true)).toBe("default-folder-opened");
  });

  // A name the set lacks would render as an empty box.
  test("every icon the tables name exists in the set", () => {
    const missing = [
      ...Object.values({ ...FILE_NAMES, ...FILE_EXTENSIONS }).map((name) => `file-type-${name}`),
      ...Object.values(FOLDER_NAMES).flatMap((name) => [
        `folder-type-${name}`,
        `folder-type-${name}-opened`,
      ]),
      "default-file",
      "default-folder",
      "default-folder-opened",
    ].filter((name) => !known.has(name));
    expect([...new Set(missing)]).toEqual([]);
  });
});
