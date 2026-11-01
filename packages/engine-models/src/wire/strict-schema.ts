/**
 * A tool's JSON Schema in the form OpenAI's strict function calling takes, or `undefined` when
 * the schema cannot be expressed there and the tool stays non-strict (decided per tool).
 *
 * Strict mode needs every property of every object listed as required and every object closed,
 * so an optional property becomes required and nullable: the model sends `null` for "absent".
 * The way back is the run's argument coercion (engine-loop `coerceToSchema`), which drops a
 * `null` on an optional property whose schema does not accept null. That is what makes the
 * conversion safe: an optional property that DOES accept null is refused, since its `null` would
 * then be ambiguous. Only keywords known to be supported pass; anything else (`$ref`, `oneOf`,
 * `allOf`, open records, `default`, `format`, `pattern`, …) leaves the tool non-strict.
 */
type Json = Record<string, unknown>

// Only keywords OpenAI's Structured Outputs guide shows working in a strict schema reach it: a
// keyword it rejects fails the whole request (a 400). An unconfirmed bound (`minLength`,
// `maxLength`, `minItems`, `maxItems`) and `title` are left out of the strict copy instead; the
// tool's own schema still checks every call after it arrives, as it does today. A `const` is sent
// as the one-member `enum` it means, and a `oneOf` as `anyOf` (below). Anything else refuses.
const KEYWORDS = new Set([
  'type',
  'description',
  'enum',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'anyOf',
  'oneOf',
  'minimum',
  'maximum',
])
const DROPPED = new Set(['title', 'minLength', 'maxLength', 'minItems', 'maxItems'])

class Unsupported extends Error {}

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function acceptsNull(schema: Json): boolean {
  const type = schema.type
  if (type === 'null' || (Array.isArray(type) && type.includes('null'))) return true
  if (schema.const === null) return true
  if (Array.isArray(schema.enum) && schema.enum.includes(null)) return true
  return Array.isArray(schema.anyOf) && schema.anyOf.some((b) => isRecord(b) && acceptsNull(b))
}

function convert(schema: Json): Json {
  const out: Json = {}
  for (const [key, value] of Object.entries(schema)) {
    if (DROPPED.has(key)) continue
    if (key === 'const') {
      if (schema.enum !== undefined) throw new Unsupported('const')
      out.enum = [value]
    } else if (KEYWORDS.has(key)) out[key] = value
    else throw new Unsupported(key)
  }
  // Strict mode takes `anyOf` only. A `oneOf` (a discriminated union) is widened to it: the
  // tool's own schema still decides which branch a call fits.
  const branches = schema.anyOf ?? schema.oneOf
  if (branches !== undefined) {
    if (!Array.isArray(branches) || (schema.anyOf && schema.oneOf)) throw new Unsupported('anyOf')
    delete out.oneOf
    out.anyOf = branches.map((branch) => {
      if (!isRecord(branch)) throw new Unsupported('anyOf')
      return convert(branch)
    })
  }
  if (schema.items !== undefined) {
    if (!isRecord(schema.items)) throw new Unsupported('items')
    out.items = convert(schema.items)
  }
  if (schema.properties !== undefined) {
    if (!isRecord(schema.properties)) throw new Unsupported('properties')
    if (schema.additionalProperties !== undefined && schema.additionalProperties !== false)
      throw new Unsupported('additionalProperties')
    const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : [])
    const properties: Json = {}
    for (const [name, value] of Object.entries(schema.properties)) {
      if (!isRecord(value)) throw new Unsupported(name)
      const inner = convert(value)
      if (required.has(name)) properties[name] = inner
      else if (acceptsNull(inner)) throw new Unsupported(`${name} is optional and nullable`)
      else properties[name] = { anyOf: [inner, { type: 'null' }] }
    }
    out.properties = properties
    out.required = Object.keys(properties)
    out.additionalProperties = false
  } else if (schema.additionalProperties !== undefined) {
    throw new Unsupported('additionalProperties')
  }
  return out
}

// What OpenAI accepts of one strict schema; past any of them the whole request is a 400.
const LIMITS = { properties: 5_000, depth: 10, enumValues: 1_000, enumChars: 15_000 }

/** True when the converted schema stays inside OpenAI's strict-mode size limits. */
function withinLimits(root: Json): boolean {
  const total = { properties: 0, enumValues: 0, enumChars: 0 }
  const walk = (node: unknown, depth: number): boolean => {
    if (!isRecord(node)) return true
    const level = node.properties !== undefined || node.items !== undefined ? depth + 1 : depth
    if (level > LIMITS.depth) return false
    if (Array.isArray(node.enum)) {
      total.enumValues += node.enum.length
      for (const value of node.enum) if (typeof value === 'string') total.enumChars += value.length
    }
    if (isRecord(node.properties)) {
      total.properties += Object.keys(node.properties).length
      for (const child of Object.values(node.properties)) if (!walk(child, level)) return false
    }
    if (!walk(node.items, level)) return false
    if (Array.isArray(node.anyOf)) for (const b of node.anyOf) if (!walk(b, level)) return false
    return true
  }
  return (
    walk(root, 0) &&
    total.properties <= LIMITS.properties &&
    total.enumValues <= LIMITS.enumValues &&
    total.enumChars <= LIMITS.enumChars
  )
}

export function strictToolSchema(schema: Json): Json | undefined {
  if (schema.type !== 'object' || !isRecord(schema.properties)) return undefined
  try {
    const converted = convert(schema)
    return withinLimits(converted) ? converted : undefined
  } catch (error) {
    if (error instanceof Unsupported) return undefined
    throw error
  }
}
