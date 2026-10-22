/**
 * `agent(prompt, { schema })`: the agent's reply as a JSON value matching a JSON Schema.
 *
 * Claude Code forces a StructuredOutput tool on such an agent and retries until the value fits. A
 * Localix child has no such tool, so the schema rides in its task and its final reply is parsed:
 * the first JSON value in it, fenced or not. A reply that does not parse or fit is asked for again
 * with the reason, up to {@link STRUCTURED_ATTEMPTS} times, and then the call fails with the last
 * reason — as Claude Code fails it after five attempts.
 *
 * The check covers the JSON Schema a workflow writes: `type`, `properties`, `required`, `items`,
 * `enum` and `additionalProperties: false`. Other keywords are not checked.
 */

export const STRUCTURED_ATTEMPTS = 5

type Schema = Record<string, unknown>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Why a schema cannot be satisfied or used, before any agent starts; null when it can. */
export function schemaProblem(schema: unknown): string | null {
  if (!isRecord(schema) || schema.type !== 'object' || !isRecord(schema.properties))
    return 'a schema needs { type: "object", properties: { … } } at its root'
  const required = Array.isArray(schema.required) ? schema.required : []
  const missing = required.filter(
    (key) => typeof key !== 'string' || !Object.hasOwn(schema.properties as object, key),
  )
  return missing.length
    ? `required names ${missing.map(String).join(', ')}, which properties do not declare`
    : null
}

/** What the agent is told besides its prompt. */
export function structuredInstruction(schema: Schema): string {
  return [
    'Your final reply must be ONLY one JSON value matching this JSON Schema, with no prose around it:',
    '```json',
    JSON.stringify(schema, null, 2),
    '```',
  ].join('\n')
}

/** The first JSON object or array in a reply, a fenced block first. */
function jsonIn(text: string): unknown {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(text)
  const candidates = [fenced?.[1], text]
  for (const candidate of candidates) {
    if (!candidate) continue
    const start = candidate.search(/[[{]/)
    if (start < 0) continue
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'))
    try {
      return JSON.parse(candidate.slice(start, end + 1))
    } catch {
      // The next candidate.
    }
  }
  throw new Error('the reply holds no JSON value')
}

const TYPE_CHECKS: Record<string, (value: unknown) => boolean> = {
  object: isRecord,
  array: Array.isArray,
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  integer: (value) => Number.isInteger(value),
  boolean: (value) => typeof value === 'boolean',
  null: (value) => value === null,
}

/** The first way `value` misses `schema`, as a path and a reason; null when it fits. */
export function schemaMismatch(value: unknown, schema: unknown, path = '$'): string | null {
  if (!isRecord(schema)) return null
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  if (types.length && !types.some((type) => TYPE_CHECKS[String(type)]?.(value)))
    return `${path} should be ${types.join(' or ')}`
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => option === value))
    return `${path} should be one of ${JSON.stringify(schema.enum)}`
  if (Array.isArray(value) && schema.items) {
    for (const [index, item] of value.entries()) {
      const found = schemaMismatch(item, schema.items, `${path}[${index}]`)
      if (found) return found
    }
  }
  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {}
    for (const key of Array.isArray(schema.required) ? schema.required : [])
      if (!Object.hasOwn(value, String(key))) return `${path}.${String(key)} is required`
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        const found = schemaMismatch(item, properties[key], `${path}.${key}`)
        if (found) return found
      } else if (schema.additionalProperties === false) return `${path}.${key} is not allowed`
    }
  }
  return null
}

/** The reply as a value that fits `schema`, or the reason it does not. */
export function parseStructured(
  text: string,
  schema: Schema,
): { value: unknown } | { problem: string } {
  let value: unknown
  try {
    value = jsonIn(text)
  } catch (error) {
    return { problem: (error as Error).message }
  }
  const mismatch = schemaMismatch(value, schema)
  return mismatch ? { problem: mismatch } : { value }
}
