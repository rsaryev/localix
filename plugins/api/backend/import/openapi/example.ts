/**
 * Schema → a plausible example value. This is what turns an OpenAPI operation into a request with
 * a body you can actually send, rather than an empty POST.
 *
 * Three deliberate safeguards apply:
 *
 *   1. DETERMINISM. A fixed `string_date-time` example keeps repeated imports byte-identical.
 *   2. FALSY EXAMPLES. An explicit `0`, `false`, or empty string remains an example instead of being
 *      replaced by a mock.
 *   3. CYCLES. A depth cap and branch-local seen-set make circular schemas terminate after refs are
 *      resolved.
 */

import { resolveRef } from './pointer'
import type { OASchema } from './types'

/** A fixed instant for `date-time` mocks — see the header on determinism. */
const EXAMPLE_INSTANT = '2020-01-01T00:00:00.000Z'
const EXAMPLE_DATE = '2020-01-01'

/** Leaf mocks by `type` and `type_format`. */
const TYPE_EXAMPLES: Record<string, unknown> = {
  string: 'string',
  string_email: 'user@example.com',
  'string_date-time': EXAMPLE_INSTANT,
  string_date: EXAMPLE_DATE,
  string_byte: 'ZXhhbXBsZQ==',
  string_uuid: '00000000-0000-0000-0000-000000000000',
  string_uri: 'https://example.com',
  number: 0,
  number_float: 0,
  integer: 0,
  boolean: true,
}

/**
 * How deep to walk. A real spec nests a handful of levels; past this, a body is not illustrating
 * anything a person will read. It is also the backstop that makes a cyclic schema terminate even
 * if the seen-set is defeated (two mutually-recursive schemas reached by different paths).
 */
const MAX_DEPTH = 8

interface Ctx {
  document: unknown
  /** Schema objects on the current branch — a repeat is a cycle. */
  seen: Set<OASchema>
  depth: number
}

/**
 * An example for `schema`, or `undefined` when there is nothing honest to say.
 *
 * `undefined` is meaningful and distinct from `null`: `JSON.stringify` DROPS an undefined
 * property, which is exactly right for a `readOnly` field (a response-only field must not be sent)
 * and for a schema we could not read. `null` would assert the field exists and is empty.
 */
export function exampleFor(document: unknown, schema: OASchema | undefined): unknown {
  return walk({ document, seen: new Set(), depth: 0 }, schema)
}

function walk(ctx: Ctx, raw: OASchema | undefined): unknown {
  if (!raw || ctx.depth > MAX_DEPTH) return undefined
  const schema = resolveRef<OASchema>(ctx.document, raw)
  if (!schema) return undefined

  // A schema already on this branch is a cycle: stop rather than descend into it again.
  if (ctx.seen.has(schema)) return undefined

  // readOnly is response-only — sending it back is what the flag exists to prevent.
  if (schema.readOnly === true) return undefined

  // An explicit example or default WINS, whatever its value. `example: 0` is an example.
  if (schema.example !== undefined) return schema.example
  if (schema.default !== undefined) return schema.default
  // An enum documents the ONLY legal values, so the first is a better guess than a type mock.
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]

  const next: Ctx = { ...ctx, seen: new Set(ctx.seen).add(schema), depth: ctx.depth + 1 }

  // allOf is an intersection: merge every branch, with later keys winning.
  if (Array.isArray(schema.allOf)) {
    const merged: Record<string, unknown> = {}
    for (const sub of schema.allOf) {
      const value = walk(next, sub)
      if (value && typeof value === 'object' && !Array.isArray(value)) Object.assign(merged, value)
    }
    return Object.keys(merged).length > 0 ? merged : undefined
  }
  // oneOf/anyOf are a choice; the first branch is as good a guess as any and is the only stable one.
  const choice = schema.oneOf ?? schema.anyOf
  if (Array.isArray(choice) && choice.length > 0) return walk(next, choice[0])

  if (schema.properties) {
    const out: Record<string, unknown> = {}
    for (const [key, sub] of Object.entries(schema.properties)) {
      const value = walk(next, sub)
      if (value !== undefined) out[key] = value
    }
    return out
  }

  if (schema.type === 'array') {
    const item = walk(next, schema.items)
    return item === undefined ? [] : [item]
  }
  if (schema.type === 'object') return {}

  if (schema.type) {
    const keyed = schema.format ? TYPE_EXAMPLES[`${schema.type}_${schema.format}`] : undefined
    return keyed ?? TYPE_EXAMPLES[schema.type] ?? undefined
  }
  return undefined
}

/**
 * A parameter's example, flattened to the string a query/header pair carries.
 *
 * An object- or array-valued parameter is JSON-encoded rather than exploded into `a[b]=c` keys.
 * OpenAPI defines multiple serialization styles (`form`, `spaceDelimited`, `pipeDelimited`, and
 * `deepObject` among them); guessing one can produce a plausible but incorrect request, while JSON
 * remains visibly a value to edit.
 */
export function parameterValue(
  document: unknown,
  schema: OASchema | undefined,
  example?: unknown,
): string {
  const value = example !== undefined ? example : exampleFor(document, schema)
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}
