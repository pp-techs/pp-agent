import { readFileSync } from "node:fs";
import { LANGUAGE_SETTINGS, type LanguageSetting } from "@workspace/shared";
import { createI18n, resolveLanguage } from "@workspace/shared/i18n";
import { app } from "electron";

const i18n = createI18n("en");
let settingsFile = "";

export function initI18n(file: string): void {
  settingsFile = file;
}

/** The agent process owns settings.json; the file is small, so read it per call to follow changes. */
function languageSetting(): LanguageSetting {
  try {
    const raw: unknown = JSON.parse(readFileSync(settingsFile, "utf8"));
    const value =
      typeof raw === "object" && raw !== null && "language" in raw ? raw.language : null;
    return LANGUAGE_SETTINGS.find((setting) => setting === value) ?? "system";
  } catch {
    return "system";
  }
}

/**
 * Translator for texts the main process shows (dialogs, update messages), in the app's language
 * as of this call: `translator()("updates.checkFailed")`.
 */
export function translator() {
  // Resources are bundled, so the language switch is synchronous.
  void i18n.changeLanguage(resolveLanguage(languageSetting(), app.getLocale()));
  return i18n.getFixedT(null, "backend");
}
