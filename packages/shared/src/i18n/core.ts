import i18next, { type i18n as I18n, type Module, type Resource } from "i18next";
import { LANGUAGES, type Language, type LanguageSetting } from "../index.ts";
import type { resources } from "./resources.ts";

/** Namespaces the window shows. */
export const RENDERER_NAMESPACES = [
  "common",
  "chat",
  "settings",
  "models",
  "agents",
  "extensions",
  "modals",
] as const;

/** Namespaces, one per area of the app. Renderer areas and `backend` (agent and main process). */
export const NAMESPACES = [...RENDERER_NAMESPACES, "backend"] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const DEFAULT_LANGUAGE: Language = "en";

/** Name of each language in itself, for the language picker. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  vi: "Tiếng Việt",
};

/** `vi`, `vi-VN` → `vi`; anything not translated → English. */
export function matchLanguage(locale: string | undefined): Language {
  const base = (locale ?? "").toLowerCase().split(/[-_]/)[0];
  return LANGUAGES.find((language) => language === base) ?? DEFAULT_LANGUAGE;
}

/** The language to show for a setting, given the operating system's locale. */
export function resolveLanguage(setting: LanguageSetting, systemLocale: string): Language {
  return setting === "system" ? matchLanguage(systemLocale) : setting;
}

/**
 * A translator over `bundled` (the namespaces in `ns`). A separate instance per process (renderer,
 * agent, main); each follows its own language. `plugins` are used before `init` (the renderer
 * passes react-i18next's binding).
 */
export function initI18n(
  language: Language,
  bundled: Resource,
  ns: readonly Namespace[],
  plugins: readonly Module[],
): I18n {
  const instance = i18next.createInstance();
  for (const plugin of plugins) instance.use(plugin);
  void instance.init({
    lng: language,
    fallbackLng: DEFAULT_LANGUAGE,
    resources: bundled,
    ns: [...ns],
    defaultNS: "common",
    // Resources are bundled, so `init` completes synchronously.
    initAsync: false,
    // React escapes on its own; the agent and main process produce plain text.
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instance;
}

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: (typeof resources)["en"];
  }
}
