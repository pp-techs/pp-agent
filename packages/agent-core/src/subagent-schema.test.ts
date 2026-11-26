import { describe, expect, test } from "vite-plus/test";
import {
  appendOutputContract,
  buildSchemaRetryPrompt,
  coerceOutputSchema,
  extractJsonCandidate,
  validateOutput,
} from "./subagent-schema.ts";
import { PrefixCacheGate } from "./subagent.ts";

describe("subagent-schema", () => {
  test("coerceOutputSchema accepts object or JSON string and rejects non-objects", () => {
    expect(coerceOutputSchema(undefined)).toEqual({ schema: null, error: null });
    expect(coerceOutputSchema({ type: "object" })).toEqual({
      schema: { type: "object" },
      error: null,
    });
    expect(coerceOutputSchema('{"type":"array"}')).toEqual({
      schema: { type: "array" },
      error: null,
    });
    expect(coerceOutputSchema("not json").error).toContain("JSON Schema object");
    expect(coerceOutputSchema([1, 2]).error).toContain("JSON Schema object");
  });

  test("extractJsonCandidate strips markdown fences and surrounding prose, preserving arrays", () => {
    expect(extractJsonCandidate('Here is the result:\n```json\n[{"a":1},{"a":2}]\n```')).toBe(
      '[{"a":1},{"a":2}]',
    );
    expect(extractJsonCandidate('Result: {"ok": true, "items": [1]} done.')).toBe(
      '{"ok": true, "items": [1]}',
    );
  });

  test("validateOutput checks required fields, types, nested items, enum, and bounds", () => {
    const schema = {
      type: "object",
      required: ["status", "items"],
      properties: {
        status: { type: "string", enum: ["ok", "warn"] },
        items: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["name", "amount"],
            properties: {
              name: { type: "string", minLength: 1 },
              amount: { type: "number", minimum: 0 },
            },
          },
        },
      },
    };

    const valid = validateOutput(
      '```json\n{"status":"ok","items":[{"name":"A","amount":10}]}\n```',
      schema,
    );
    expect(valid.ok).toBe(true);

    const invalid = validateOutput('{"status":"bad","items":[{"name":"","amount":-5}]}', schema);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.errors.some((e) => e.includes("$.status"))).toBe(true);
      expect(invalid.errors.some((e) => e.includes("$.items[0].name"))).toBe(true);
      expect(invalid.errors.some((e) => e.includes("$.items[0].amount"))).toBe(true);
      const retry = buildSchemaRetryPrompt(invalid.errors);
      expect(retry).toContain("Do not call any tools");
      expect(retry).toContain("$.status");
    }
  });

  test("appendOutputContract appends machine-validated contract block", () => {
    const out = appendOutputContract("Base prompt", { type: "object" });
    expect(out).toContain("Base prompt");
    expect(out).toContain("OUTPUT CONTRACT (machine-validated):");
    expect(out).toContain('"type": "object"');
  });
});

describe("PrefixCacheGate", () => {
  test("holds same-route siblings until leader opens, but lets different routes pass immediately", async () => {
    const gate = new PrefixCacheGate("anthropic/claude-sonnet", 5_000);
    // Different route passes right away without waiting.
    await gate.wait("openai/gpt-5", undefined);

    let released = false;
    const waiting = gate.wait("anthropic/claude-sonnet", undefined).then(() => {
      released = true;
    });
    await Promise.resolve();
    expect(released).toBe(false);
    gate.open();
    await waiting;
    expect(released).toBe(true);
  });

  test("releases immediately if aborted", async () => {
    const gate = new PrefixCacheGate("anthropic/claude-sonnet", 5_000);
    const controller = new AbortController();
    const waiting = gate.wait("anthropic/claude-sonnet", controller.signal);
    controller.abort();
    await waiting;
  });
});
