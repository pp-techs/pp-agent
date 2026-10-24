# Use case: managing models, providers, and gateways

**Actor:** tech team or user, in **Settings › Models**.

## Providers

Sign in to any of Pi's built-in providers (Anthropic, OpenAI, Google, OpenRouter, …) with an API key. Sign-in prompts appear as an auth dialog; disconnecting removes the key. Only configured providers contribute models to the picker (`apps/desktop/src/agent/providers.ts`, `availableModels`).

## Gateways

A gateway is a custom OpenAI- or Anthropic-compatible endpoint: name, API type, URL, API key, models.

- "This gateway needs an API key" (default on). Turn it off for local endpoints such as Ollama, LM Studio or vLLM: the key field becomes optional, models load without a key, and the gateway's models are available right away. A key saved anyway overrides the placeholder. A gateway that needs a key and has none shows "Needs API key" on its row; its models are listed in the picker marked "Needs key" and cannot be selected (a toast offers to open Settings › Models).
- The model list is fetched from the gateway (OpenAI-compatible: `GET {base}/models` with a Bearer key; Anthropic: `GET {base}/v1/models` with `x-api-key`), from the agent process because the renderer has no network access.
- Models are picked with a multi-select (checkbox rows showing the context window, "N of M selected", Select all / Clear on the filtered list); each selected model has an editable display name (prefilled with the name the gateway reports), a context window field, and image and reasoning toggles. A blank context window means the size the gateway reported or Pi knows for that model.
- Gateway ids are `gw-<slug of name>`, made unique. Model defaults when nothing reports a size: images on, context window 128000, max tokens 16384, reasoning off, zero cost (`apps/desktop/src/agent/providers.ts`).

## Picking a model

- Model names are shown short (`modelLabel` in `apps/web/src/lib/models.ts`): the part after the last `/`, and for a raw lowercase id the dashes become spaces, a one-digit pair becomes a version, and words are capitalized (`anthropic-subscription/claude-sonnet-5-5` → "Claude Sonnet 5.5"). Names with spaces or capitals are kept; the full id is the tooltip. When one provider lists the same short name twice, `modelLabeler` adds the id's prefix in brackets ("Claude Sonnet 5.5 (team-a)"), or the whole id when the prefixes do not tell them apart; the gateway form warns about repeated names.

- Per conversation, under the message box; the choice is saved in the session file.
- New chat: the agent's model, else the default model from Settings, else the first available model; with none the app reports it is unconfigured.
- Opening a saved chat restores its model when it is still available.

## Keys

Every key lives in the vault (`credentials.json`), encrypted with Electron safeStorage and decrypted only by the main process. A legacy single-gateway `provider.json` is migrated once at startup into gateway `gw-gateway` and then deleted (`apps/desktop/src/main/legacy.ts`).
