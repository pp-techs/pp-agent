/**
 * Gateway models backfill `reasoning`/`images` (and limits) from Pi's built-in catalog when the
 * gateway config or the gateway's `/models` response does not say, matching by bare id.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxProvider } from "@earendil-works/pi-ai";
import type { GatewayConfig } from "@workspace/shared";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { fetchGatewayModels, syncGateways } from "./providers.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.unstubAllGlobals();
});

/** A runtime whose "openai" catalog has one known reasoning+image model, for backfill tests. */
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "pp-agent-providers-"));
  dirs.push(dir);
  const runtime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  const faux = fauxProvider({
    provider: "openai",
    models: [
      {
        id: "gpt-5",
        name: "GPT-5",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 400_000,
        maxTokens: 100_000,
      },
      {
        id: "gpt-5-no-vision",
        reasoning: true,
        input: ["text"],
        contextWindow: 200_000,
        maxTokens: 50_000,
      },
    ],
  });
  runtime.registerNativeProvider(faux.provider);
  return runtime;
}

function gateway(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    id: "gw-test",
    name: "Test gateway",
    api: "openai-completions",
    baseUrl: "https://gateway.example",
    requiresApiKey: true,
    models: [],
    ...overrides,
  };
}

describe("syncGateways / gatewayProvider capability backfill", () => {
  test("backfills reasoning and images from the catalog when unset", async () => {
    const runtime = await setup();
    await syncGateways(runtime, [gateway({ models: [{ id: "gpt-5" }] })], new Set());
    const [model] = runtime.getModels("gw-test");
    expect(model.reasoning).toBe(true);
    expect(model.input).toEqual(["text", "image"]);
    expect(model.contextWindow).toBe(400_000);
    expect(model.maxTokens).toBe(100_000);
  });

  test("catalog images:false is honored when the gateway model does not override it", async () => {
    const runtime = await setup();
    await syncGateways(runtime, [gateway({ models: [{ id: "gpt-5-no-vision" }] })], new Set());
    const [model] = runtime.getModels("gw-test");
    expect(model.reasoning).toBe(true);
    expect(model.input).toEqual(["text"]);
  });

  test("an explicit gateway setting overrides the catalog", async () => {
    const runtime = await setup();
    await syncGateways(
      runtime,
      [gateway({ models: [{ id: "gpt-5", reasoning: false, images: false }] })],
      new Set(),
    );
    const [model] = runtime.getModels("gw-test");
    expect(model.reasoning).toBe(false);
    expect(model.input).toEqual(["text"]);
  });

  test("an id with no catalog match defaults to reasoning false, images true", async () => {
    const runtime = await setup();
    await syncGateways(runtime, [gateway({ models: [{ id: "unknown-model" }] })], new Set());
    const [model] = runtime.getModels("gw-test");
    expect(model.reasoning).toBe(false);
    expect(model.input).toEqual(["text", "image"]);
  });
});

describe("fetchGatewayModels capability backfill", () => {
  test("backfills reasoning/images from the catalog when the gateway response omits them", async () => {
    const runtime = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "gpt-5" }] }), { status: 200 })),
    );
    const [model] = await fetchGatewayModels(
      runtime,
      "openai-completions",
      "https://gateway.example",
      "key",
    );
    expect(model.reasoning).toBe(true);
    expect(model.images).toBe(true);
    expect(model.contextWindow).toBe(400_000);
    expect(model.maxTokens).toBe(100_000);
  });

  test("OpenRouter-style modalities and supported_parameters override the catalog", async () => {
    const runtime = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  id: "gpt-5-no-vision",
                  architecture: { input_modalities: ["text", "image"] },
                  supported_parameters: ["reasoning"],
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const [model] = await fetchGatewayModels(
      runtime,
      "openai-completions",
      "https://gateway.example",
      "key",
    );
    expect(model.reasoning).toBe(true);
    expect(model.images).toBe(true);
  });

  test("an id with no catalog match and no reported modalities leaves capabilities unset", async () => {
    const runtime = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{ id: "unknown-model" }] }), { status: 200 }),
      ),
    );
    const [model] = await fetchGatewayModels(
      runtime,
      "openai-completions",
      "https://gateway.example",
      "key",
    );
    expect(model.reasoning).toBeUndefined();
    expect(model.images).toBeUndefined();
  });
});
