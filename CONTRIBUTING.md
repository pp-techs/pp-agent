# Contributing to PP Agent

Thanks for helping. This guide covers the setup, the checks a change must pass, and how releases work.

## Before you start

- For anything larger than a small fix, open an issue first so we can agree on the approach.
- Read [docs/SUMMARY.md](docs/SUMMARY.md); the [Code Standard](docs/SUMMARY.md#code-standard) docs describe the conventions reviewers will look for.
- Report security problems privately (see [SECURITY.md](SECURITY.md)), not in public issues.

## Set up

Requires the [Vite+ CLI](https://viteplus.dev/guide/) (`vp`), which manages Node.js and pnpm.

```bash
git clone https://github.com/pp-techs/pp-agent.git
cd pp-agent
vp install
vp run dev      # renderer dev server + Electron
```

## Make a change

1. Branch from `main`.
2. Cross-process changes start in the shared contract, `packages/shared/src/index.ts` (see [Renderer and contract](docs/codebase/renderer-and-contract.md)).
3. Keep UI copy plain for non-technical users.
4. Run the checks:

   ```bash
   vp check            # format, lint, type check
   vp run -r build     # renderer + desktop bundles
   ```

5. Exercise the change in the running app (`vp run dev`). For agent behaviour, use a copy of your user data (`--user-data-dir`), never your real profile.
6. Add a changeset if people using the app will notice the change:

   ```bash
   vp run changeset
   ```

   Pick `@workspace/desktop`, choose `patch` or `minor`, and describe the change for the release notes. Docs, CI, and internal refactors need no changeset.

7. Open a pull request with a [Conventional Commits](https://www.conventionalcommits.org) title, such as `feat(agents): import agents from a URL`.

## Releases

Maintainers release by merging the "Version Packages" pull request that the release workflow keeps up to date from pending changesets. The workflow then builds installers for macOS, Windows, and Linux and publishes a GitHub Release. Details: [docs/code-standard/release-process.md](docs/code-standard/release-process.md).

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
