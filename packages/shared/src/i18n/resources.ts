import agentsEn from "./locales/en/agents.json" with { type: "json" };
import backendEn from "./locales/en/backend.json" with { type: "json" };
import chatEn from "./locales/en/chat.json" with { type: "json" };
import commonEn from "./locales/en/common.json" with { type: "json" };
import extensionsEn from "./locales/en/extensions.json" with { type: "json" };
import modalsEn from "./locales/en/modals.json" with { type: "json" };
import modelsEn from "./locales/en/models.json" with { type: "json" };
import settingsEn from "./locales/en/settings.json" with { type: "json" };
import agentsVi from "./locales/vi/agents.json" with { type: "json" };
import backendVi from "./locales/vi/backend.json" with { type: "json" };
import chatVi from "./locales/vi/chat.json" with { type: "json" };
import commonVi from "./locales/vi/common.json" with { type: "json" };
import extensionsVi from "./locales/vi/extensions.json" with { type: "json" };
import modalsVi from "./locales/vi/modals.json" with { type: "json" };
import modelsVi from "./locales/vi/models.json" with { type: "json" };
import settingsVi from "./locales/vi/settings.json" with { type: "json" };

const en = {
  agents: agentsEn,
  backend: backendEn,
  chat: chatEn,
  common: commonEn,
  extensions: extensionsEn,
  modals: modalsEn,
  models: modelsEn,
  settings: settingsEn,
};

const vi = {
  agents: agentsVi,
  backend: backendVi,
  chat: chatVi,
  common: commonVi,
  extensions: extensionsVi,
  modals: modalsVi,
  models: modelsVi,
  settings: settingsVi,
};

/**
 * Every English key must exist in each other language, or the build fails. Plural forms are the
 * exception: English has `_one` and `_other`, Vietnamese only `_other`, so `_one` keys are left out.
 */
type Parity<T> = {
  [K in keyof T as K extends `${string}_one` ? never : K]: T[K] extends string
    ? string
    : Parity<T[K]>;
};

const checkedVi: Parity<typeof en> = vi;

export const resources = { en, vi: checkedVi };
