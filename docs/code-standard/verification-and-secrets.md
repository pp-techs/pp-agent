# Verification and secrets hygiene

## Before handing off

Run `vp check` (format, lint, type check) and `vp test`. `vp run ready` checks and builds everything.

## Smoke-testing the Electron app

Practice used for UI changes (no script is committed for it):

1. Start Electron with `--remote-debugging-port=<port>` and `--user-data-dir=<copy>`, where `<copy>` is a copy of a user-data folder under `tmp/`.
2. Drive the window from a throwaway script with `playwright-core`'s `chromium.connectOverCDP("http://127.0.0.1:<port>")`.
3. Never point a test at the real `<user-data>` (`~/Library/Application Support/PP Agent`, `%APPDATA%\PP Agent`) or the real workspace: they hold the person's conversations and keys.

## Secrets

- `tmp/` is gitignored ("Local scratch files (may hold credentials)"); keep scratch data and test credentials there.
- Never print, cat, or log `tmp/credentials.env` or any API key; load it into the environment instead.
- `.env` and `.env.*` are gitignored too (except `.env.example`).
- Do not log decrypted vault values in main or the agent process.
