# TypeScript, formatting, and naming

## Formatting

oxfmt via `vp check`, `printWidth: 100`. Observed style: semicolons, double quotes, trailing commas. Never hand-format; run `vp check --fix`.

## TypeScript

- `strict: true` in every package tsconfig.
- Relative imports carry the `.ts` extension (`allowImportingTsExtensions`), e.g. `import { handleVaultRequest } from "./vault.ts";` in `apps/desktop/src/main/index.ts`. Cross-package imports use the workspace name (`@workspace/shared`, `@workspace/ui/components/button`).
- No `any`. Values arriving over IPC are typed `unknown` and narrowed (`typeof path !== "string"`) before use.
- Validate persisted or external JSON with `typebox` schemas (`Type.Object(...)`), as in `apps/desktop/src/agent/settings-store.ts`; tool parameters are typebox schemas too (`defineTool({ parameters: Type.Object({}) })` in `apps/desktop/src/agent/tools.ts`).
- Prefer `import type` for type-only imports.
- Doc comments (`/** … */`) explain why, in one or two sentences; group long classes with `// ----` banner comments (see `apps/desktop/src/agent/index.ts`).
- Error messages are plain sentences a user can read (`"That conversation is not in this app's history."`); they surface in toasts.

## Naming and files

- Files: kebab-case (`prompt-composer.tsx`, `settings-store.ts`, `use-send-message.ts`).
- React components: PascalCase exports (`SectionHeading`, `OptionGroup`). Modals end in `Modal` and live in `apps/web/src/components/modals/`.
- Hooks: `use-*.ts` files in `apps/web/src/hooks/`, exported as `useX`.
- Zustand stores: `apps/web/src/stores/<name>-store.ts`, exported as `use<Name>Store`.
- Query definitions: `<thing>Query(bridge)` factories and `use<Thing>` mutation hooks in `apps/web/src/lib/queries.ts`.
- Query keys: `queryKeys` in `apps/web/src/lib/queries.ts`. Keys for settings data match a `SettingsScope` value (`settings`, `providers`, `models`, `tools`, `skills`, `mcp`, `agents`) so a `settings_changed` event invalidates `[scope]` directly. Add a new scope to `SettingsScope` and a key with the same string together.
- Settings UI: one `<area>-section.tsx` per pane, `<thing>-editor.tsx` / `<thing>-form.tsx` for in-pane editors, in `apps/web/src/components/settings/`.
- Agent-process modules in `apps/desktop/src/agent/` are named by concern (`mcp.ts`, `skills.ts`, `tools.ts`, `credentials.ts`).
