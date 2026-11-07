import type { i18n as I18n, Module } from "i18next";
import type { Language } from "../index.ts";
import { initI18n, NAMESPACES } from "./core.ts";
import { resources } from "./resources.ts";

export {
  DEFAULT_LANGUAGE,
  LANGUAGE_NAMES,
  matchLanguage,
  NAMESPACES,
  RENDERER_NAMESPACES,
  resolveLanguage,
  type Namespace,
} from "./core.ts";
export { resources } from "./resources.ts";
export type { Language, LanguageSetting } from "../index.ts";

/**
 * A translator with every namespace, for the agent and main process; the renderer uses
 * `createRendererI18n` from `@workspace/shared/i18n/renderer`, without `backend`.
 */
export function createI18n(language: Language, plugins: readonly Module[] = []): I18n {
  return initI18n(language, resources, NAMESPACES, plugins);
}
