import { createI18n, matchLanguage } from "@workspace/shared/i18n";
import { initReactI18next } from "react-i18next";

/** The renderer's translator. Starts in the system language; `LanguageSync` applies the setting. */
export const i18n = createI18n(matchLanguage(navigator.language), [initReactI18next]);
