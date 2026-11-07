import type { i18n as I18n, Module } from "i18next";
import type { Language } from "../index.ts";
import { initI18n, RENDERER_NAMESPACES } from "./core.ts";
import { rendererResources } from "./renderer-resources.ts";

export {
  DEFAULT_LANGUAGE,
  LANGUAGE_NAMES,
  matchLanguage,
  resolveLanguage,
  type Namespace,
} from "./core.ts";
export type { Language, LanguageSetting } from "../index.ts";

/** The window's translator: every namespace but `backend`, which stays out of its bundle. */
export function createRendererI18n(language: Language, plugins: readonly Module[] = []): I18n {
  return initI18n(language, rendererResources, RENDERER_NAMESPACES, plugins);
}
