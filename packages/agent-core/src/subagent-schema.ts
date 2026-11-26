/**
 * Structured output contract and lightweight JSON Schema validation for delegated subagents.
 *
 * When a task specifies `outputSchema`, the helper receives an OUTPUT CONTRACT block, its final
 * reply is parsed (stripping fences/prose) and validated, and on failure it gets exactly ONE
 * bounded correction turn carrying the validation errors verbatim (without re-pasting the schema).
 */

export type JsonSchema = Record<string, unknown>;

/** Validates that `raw` is a usable JSON Schema object (accepts a JSON-encoded string too). */
export function coerceOutputSchema(raw: unknown): {
  schema: JsonSchema | null;
  error: string | null;
} {
  if (raw === undefined || raw === null) return { schema: null, error: null };
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { schema: null, error: "outputSchema must be a JSON Schema object." };
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { schema: null, error: "outputSchema must be a JSON Schema object." };
  }
  return { schema: value as JsonSchema, error: null };
}

/** Appends the machine-validated output contract block to a helper's prompt or context. */
export function appendOutputContract(base: string, schema: JsonSchema): string {
  const schemaText = JSON.stringify(schema, null, 2);
  const block = [
    "OUTPUT CONTRACT (machine-validated):",
    "Your FINAL response must be ONLY the JSON value that validates against this JSON Schema — no prose before or after it, no code fence, no explanation.",
    schemaText,
  ].join("\n");
  const trimmed = base.trim();
  return trimmed ? `${trimmed}\n\n${block}` : block;
}

/** Strips markdown fences and surrounding prose around the outermost `{...}` or `[...]`. */
export function extractJsonCandidate(text: string): string {
  let raw = (text ?? "").trim();
  if (raw.startsWith("```")) {
    const firstNewline = raw.indexOf("\n");
    raw = firstNewline === -1 ? "" : raw.slice(firstNewline + 1);
    if (raw.trimEnd().endsWith("```")) raw = raw.trimEnd().slice(0, -3);
    raw = raw.trim();
    if (raw.toLowerCase().startsWith("json\n")) raw = raw.slice(5).trim();
  }
  const spans: { start: number; text: string }[] = [];
  for (const [opener, closer] of [
    ["{", "}"],
    ["[", "]"],
  ] as const) {
    const start = raw.indexOf(opener);
    const end = raw.lastIndexOf(closer);
    if (start >= 0 && end > start) spans.push({ start, text: raw.slice(start, end + 1) });
  }
  spans.sort((a, b) => a.start - b.start);
  for (const span of spans) {
    try {
      JSON.parse(span.text);
      return span.text;
    } catch {
      // Try the next bracket pair.
    }
  }
  return spans[0]?.text ?? raw;
}

function matchesType(value: unknown, expected: string): boolean {
  switch (expected) {
    case "null":
      return value === null;
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}

const MAX_ERRORS = 10;

function checkNode(value: unknown, schema: JsonSchema, path: string, errors: string[]): void {
  if (errors.length >= MAX_ERRORS) return;

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type)
      ? schema.type.filter((item): item is string => typeof item === "string")
      : typeof schema.type === "string"
        ? [schema.type]
        : [];
    if (types.length > 0 && !types.some((type) => matchesType(value, type))) {
      errors.push(`${path}: expected ${types.join(" | ")}`);
      return;
    }
  }

  if (Array.isArray(schema.enum)) {
    const serialized = JSON.stringify(value);
    if (!schema.enum.some((allowed) => JSON.stringify(allowed) === serialized)) {
      errors.push(`${path}: value is not one of the allowed enum values`);
      return;
    }
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push(`${path}: string shorter than minLength ${schema.minLength}`);
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(`${path}: ${value} is less than minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push(`${path}: ${value} is greater than maximum ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${path}: array has fewer than ${schema.minItems} items`);
    }
    if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
      const itemSchema = schema.items as JsonSchema;
      for (let index = 0; index < value.length && errors.length < MAX_ERRORS; index += 1) {
        checkNode(value[index], itemSchema, `${path}[${index}]`, errors);
      }
    }
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === "string" && !Object.hasOwn(record, key)) {
          errors.push(`${path}: missing required property "${key}"`);
          if (errors.length >= MAX_ERRORS) return;
        }
      }
    }
    if (
      schema.properties &&
      typeof schema.properties === "object" &&
      !Array.isArray(schema.properties)
    ) {
      const props = schema.properties as Record<string, unknown>;
      for (const [key, propSchema] of Object.entries(props)) {
        if (
          Object.hasOwn(record, key) &&
          propSchema &&
          typeof propSchema === "object" &&
          !Array.isArray(propSchema)
        ) {
          checkNode(record[key], propSchema as JsonSchema, `${path}.${key}`, errors);
          if (errors.length >= MAX_ERRORS) return;
        }
      }
    }
  }
}

/** Validates a helper's final text against `schema`. */
export function validateOutput(
  text: string,
  schema: JsonSchema,
): { ok: true; json: string } | { ok: false; errors: string[] } {
  const candidate = extractJsonCandidate(text);
  if (!candidate.trim()) {
    return { ok: false, errors: ["Response was empty — expected JSON matching the schema."] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    return {
      ok: false,
      errors: [
        `Response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  const errors: string[] = [];
  checkNode(parsed, schema, "$", errors);
  return errors.length === 0 ? { ok: true, json: candidate } : { ok: false, errors };
}

/** Single bounded correction prompt carrying validation errors verbatim (schema is not re-pasted). */
export function buildSchemaRetryPrompt(errors: readonly string[]): string {
  return [
    "Your previous response did not satisfy the OUTPUT CONTRACT:",
    ...errors.map((error) => `- ${error}`),
    "",
    "Do not call any tools. Reply now with ONLY the corrected JSON value matching the schema, with no prose or code fences.",
  ].join("\n");
}
