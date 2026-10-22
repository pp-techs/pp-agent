# Toolchain and setup

## Requirements

- [Vite+ CLI](https://viteplus.dev/guide/) (`vp`). It manages Node and pnpm.
- Node: root `package.json` declares `"engines": { "node": ">=24" }` (Pi itself requires `>=22.19.0`).
- pnpm 12 (`devEngines.packageManager` pins `12.14.0` with `onFail: "download"`).

## Daily commands

| Command                           | What it does                                                           |
| --------------------------------- | ---------------------------------------------------------------------- |
| `vp install`                      | Install dependencies (run after every pull).                           |
| `vp install --no-frozen-lockfile` | Needed in non-TTY shells (agents, CI scripts) when the lockfile moves. |
| `vp run dev`                      | Renderer dev server (`apps/web`) + Electron (`apps/desktop`).          |
| `vp check`                        | oxfmt formatting + oxlint with type-aware rules and type checking.     |
| `vp check --fix`                  | Same, applying fixes. Runs on staged files (`staged` in config).       |
| `vp test`                         | Vitest.                                                                |
| `vp run build` / `vp run ready`   | Build all packages / check then build.                                 |
| `vp run dist`                     | Build web, then pack the desktop app with electron-builder.            |
| `vp run changeset`                | Add a changeset for the next release (see `release-process.md`).       |

`vp <name>` is a built-in; `vp run <name>` runs a `package.json` script. `vp dev` and `vp run dev` differ — use `vp run dev`.

## Lint configuration (`vite.config.ts`)

- `lint.options: { typeAware: true, typeCheck: true }` — `vp check` is also the type check.
- Plugin `typescript` everywhere; `react` + browser env for `apps/web/**` and `packages/ui/**`; node env for `apps/desktop/**`.
- `vite-plus/prefer-vite-plus-imports` is an error: import from `vite-plus`, not `vite`/`vitest` directly.
- `dist/` and `release/` are ignored.

## Dependencies (`pnpm-workspace.yaml`)

- Every third-party version lives in the `catalog:`; packages reference it as `"catalog:"` (`catalogMode: prefer`). Workspace packages use `workspace:*`.
- Versions policy: always take the newest published version. `minimumReleaseAge: 0` deliberately disables pnpm's release-age delay; deleting that line restores it.
- `allowBuilds` lists packages whose install scripts are blocked (`@google/genai`, `electron-winstaller`, `protobufjs`, `tesseract.js` are `false`). Add an entry when a new dependency wants to run a build script.
- `vite` is overridden to the Vite+ core (`npm:@voidzero-dev/vite-plus-core`); `peerDependencyRules` accepts any `vite` peer.

## Adding a dependency

1. Add the package with its latest version to `catalog:` in `pnpm-workspace.yaml`.
2. Reference it as `"catalog:"` in the consuming `package.json`. Runtime deps of the desktop app go in `dependencies` (they ship in the package); build-only ones in `devDependencies`.
3. Run `vp install` (`--no-frozen-lockfile` if non-interactive), then `vp check`.
