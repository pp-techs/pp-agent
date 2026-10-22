# Use case: managing models, providers, and gateways

**Actor:** tech team or user, in **Settings › Models**.

## Providers

Sign in to any of Pi's built-in providers (Anthropic, OpenAI, Google, OpenRouter, …) with an API key. Sign-in prompts appear as an auth dialog; disconnecting removes the key. Only configured providers contribute models to the picker (`apps/desktop/src/agent/providers.ts`, `availableModels`).

## Gateways

A gateway is a custom OpenAI- or Anthropic-compatible endpoint: name, API type, URL, API key, models.

- The model list is fetched from the gateway (OpenAI-compatible: `GET {base}/models` with a Bearer key; Anthropic: `GET {base}/v1/models` with `x-api-key`), from the agent process because the renderer has no network access.
- Models are picked with a multi-select (checkbox rows, "N of M selected", Select all / Clear on the filtered list); each selected model has image and reasoning toggles.
- Gateway ids are `gw-<slug of name>`, made unique. Model defaults: images on, context window 128000, max tokens 16384, reasoning off, zero cost (`apps/desktop/src/agent/providers.ts`).

## Picking a model

- Per conversation, under the message box; the choice is saved in the session file.
- New chat: the agent's model, else the default model from Settings, else the first available model; with none the app reports it is unconfigured.
- Opening a saved chat restores its model when it is still available.

## Keys

Every key lives in the vault (`credentials.json`), encrypted with Electron safeStorage and decrypted only by the main process. A legacy single-gateway `provider.json` is migrated once at startup into gateway `gw-gateway` and then deleted (`apps/desktop/src/main/legacy.ts`).
