import { createI18n, resolveLanguage } from "@workspace/shared/i18n";
import type { LanguageSetting } from "@workspace/shared";

const i18n = createI18n("en");
let systemLocale = "en";

/** Texts the person reads (errors, approval cards, notices), in the app's language. */
export const t = i18n.getFixedT(null, "backend");

/** Called at start and whenever the language setting changes. */
export function configureLanguage(setting: LanguageSetting, locale?: string): void {
  if (locale !== undefined) systemLocale = locale;
  void i18n.changeLanguage(resolveLanguage(setting, systemLocale));
}

/** Language the person reads right now (`en`, `vi`). */
export function currentLanguage(): string {
  return i18n.language;
}
