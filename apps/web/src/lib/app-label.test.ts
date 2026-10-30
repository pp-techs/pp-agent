import { expect, it } from "vite-plus/test";

import { appLabel } from "./app-label";

it("names an app by the last part of its bundle id or its program file", () => {
  expect(appLabel("com.apple.Notes")).toBe("Notes");
  expect(appLabel("com.microsoft.Excel")).toBe("Excel");
  expect(appLabel("C:\\Program Files\\Notepad++\\notepad++.exe")).toBe("notepad++");
  expect(appLabel("/Applications/Zalo.app")).toBe("Zalo");
  expect(appLabel("Calculator")).toBe("Calculator");
});
