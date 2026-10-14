// Tool schemas are long-lived objects converted on EVERY request body build
// (per turn, per agent). The conversion result is pure per schema instance, so
// memoize it — keyed weakly to never pin a schema in memory.
const cache = new WeakMap<object, Record<string, unknown>>()

// Zod v4's toJSONSchema() auto-emits the JS safe-integer bounds on every
// unbounded integer field (e.g. `"maximum": 9007199254740991`). Those carry NO
// model-useful information — a tool's `offset`/`recommended` index never needs a
// 9-quadrillion ceiling spelled out — yet they ship in the tool schema (the
// dominant per-call floor) on every cache-miss. Strip ONLY the exact safe-int
// bounds; real bounds (e.g. timeout max 600, priority -2..2) are untouched.
// This is purely the WIRE schema the model sees — Zod still validates inputs.
const SAFE_INT = 9007199254740991
function stripSafeIntBounds(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) stripSafeIntBounds(item)
    return
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>
    if (obj.maximum === SAFE_INT) delete obj.maximum
    if (obj.minimum === -SAFE_INT) delete obj.minimum
    for (const key of Object.keys(obj)) stripSafeIntBounds(obj[key])
  }
}

export function zodToJsonSchema(schema: { _def?: unknown }): Record<string, unknown> {
  const cached = cache.get(schema)
  if (cached) return cached

  let result: Record<string, unknown> | undefined
  try {
    // Zod v4: use instance method toJSONSchema()
    const s = schema as { toJSONSchema?: () => Record<string, unknown> }
    if (typeof s.toJSONSchema === 'function') {
      const { $schema: _, ...rest } = s.toJSONSchema()
      result = rest
    } else {
      console.warn(
        '[localixai/agent] zodToJsonSchema: schema does not expose toJSONSchema() — is this Zod v4+? Falling back to { type: "object" }.',
      )
    }
  } catch (err) {
    console.warn(
      '[localixai/agent] zodToJsonSchema: toJSONSchema() threw, falling back to { type: "object" }.',
      err,
    )
  }

  const final = asObjectRoot(result ?? { type: 'object' })
  stripSafeIntBounds(final)
  cache.set(schema, final)
  return final
}

/**
 * A function's parameters MUST be an object schema at the root. Zod renders a top-level
 * `discriminatedUnion`/`union` as a bare `oneOf`/`anyOf` with no `type`, and OpenAI-family
 * providers reject exactly that ("schema must be a JSON Schema of 'type: object', got
 * 'type: None'" — the `vault` tool, live via OpenRouter). Every variant of such a union is an
 * object, so stating the type at the root is a truth, not a coercion, and the variants keep
 * validating the discriminator. Anthropic and Gemini accept the same shape.
 */
function asObjectRoot(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema.type !== undefined) return schema
  const variants = (schema.oneOf ?? schema.anyOf) as unknown
  if (!Array.isArray(variants) || variants.length === 0) return schema
  const allObjects = variants.every(
    (variant) =>
      variant &&
      typeof variant === 'object' &&
      (variant as Record<string, unknown>).type === 'object',
  )
  return allObjects ? { type: 'object', ...schema } : schema
}
