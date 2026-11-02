import { describe, expect, test, vi } from "vite-plus/test";
import { modelErrorDetail, modelErrorText } from "./model-error.ts";

const cloudflare524 =
  '524 {"type":"https://developers.cloudflare.com/...","status":524,"error_code":524,"retry_after":120}';

describe("modelErrorText", () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  test("hides the raw provider text behind one sentence", () => {
    const text = modelErrorText(cloudflare524);
    expect(text).not.toContain("{");
    expect(text).not.toContain("524");
  });

  test("tells timeouts, rate limits, outages and rejected keys apart", () => {
    const texts = [
      modelErrorText(cloudflare524),
      modelErrorText("429 Too Many Requests"),
      modelErrorText("503 Service Unavailable"),
      modelErrorText("401 invalid api key"),
    ];
    expect(new Set(texts).size).toBe(4);
  });

  test("falls back to the generic text for unknown or empty errors", () => {
    expect(modelErrorText(undefined)).toBe(modelErrorText("something odd happened"));
  });
});

describe("modelErrorDetail", () => {
  test("keeps the provider's own text and says which model failed", () => {
    expect(
      modelErrorDetail({ provider: "openai", model: "gpt-x", errorMessage: cloudflare524 }),
    ).toBe(`openai/gpt-x: ${cloudflare524}`);
  });

  test("still names the model when the provider gave no text", () => {
    expect(modelErrorDetail({ provider: "openai", model: "gpt-x" })).toContain("openai/gpt-x");
  });
});
