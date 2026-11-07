import backendEn from "./locales/en/backend.json" with { type: "json" };
import backendVi from "./locales/vi/backend.json" with { type: "json" };
import { rendererResources, type Parity } from "./renderer-resources.ts";

const en = { ...rendererResources.en, backend: backendEn };
const vi = { ...rendererResources.vi, backend: backendVi };

const checkedVi: Parity<typeof en> = vi;

/** Every namespace, `backend` included: what the agent and main process use. */
export const resources = { en, vi: checkedVi };
