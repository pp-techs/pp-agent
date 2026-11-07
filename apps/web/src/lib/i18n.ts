import { createRendererI18n, matchLanguage } from "@workspace/shared/i18n/renderer";
import { initReactI18next } from "react-i18next";

/** The renderer's translator. Starts in the system language; `LanguageSync` applies the setting. */
export const i18n = createRendererI18n(matchLanguage(navigator.language), [initReactI18next]);
