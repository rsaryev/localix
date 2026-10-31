/**
 * A model's tool arguments, made into the input the tool declared — or into a message the model
 * can repair its call from.
 *
 * Order: undo a `parameters` wrapper the schema does not declare, run the tool's own
 * `prepareArguments`, coerce what can only mean one thing (`"12"` for a number, a JSON string for
 * an object, `null` for an optional field), then let the tool's Zod schema decide, preprocessors
 * and defaults included. The coercion never rewrites a call that already fits.
 */
import type { z } from 'zod'

import { coerceToSchema, type JsonSchema } from './coerce'
import { messageOf } from './results'

export type ParsedArguments = { ok: true; value: unknown } | { ok: false; message: string }

/**
 * Undo a `parameters` wrapper the schema does not declare.
 *
 * A GPT-family model now and then emits it: empty beside the real arguments, or holding them
 * (LOCALIX-164: `{action: "steps", parameters: {preview_id, steps}}`, refused twice). Two forms
 * have one reading: an empty wrapper, which is dropped, and one whose every key is a declared
 * field the call does not already set differently, which is lifted. Anything else is left for
 * the schema to judge.
 */
export function unwrapParameters(args: unknown, schema: JsonSchema): unknown {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args
  if (!('parameters' in args)) return args
  const { parameters, ...rest } = args as Record<string, unknown>
  const declared = schema.properties ?? {}
  if ('parameters' in declared) return args
  if (parameters === null) return rest
  if (typeof parameters !== 'object' || Array.isArray(parameters)) return args
  const inner = Object.entries(parameters as Record<string, unknown>)
  const liftable = inner.every(
    ([key, value]) =>
      key in declared &&
      (rest[key] === undefined || JSON.stringify(rest[key]) === JSON.stringify(value)),
  )
  return liftable ? { ...rest, ...Object.fromEntries(inner) } : args
}

export function parseToolArguments(input: {
  toolName: string
  raw: unknown
  schema: z.ZodType
  jsonSchema: JsonSchema
  prepare?: (raw: unknown) => unknown
}): ParsedArguments {
  const unwrapped = unwrapParameters(input.raw, input.jsonSchema)
  let prepared: unknown
  try {
    prepared = input.prepare ? input.prepare(unwrapped) : unwrapped
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
  const direct = input.schema.safeParse(prepared)
  if (direct.success) return { ok: true, value: direct.data }
  const coerced = input.schema.safeParse(coerceToSchema(prepared, input.jsonSchema))
  if (coerced.success) return { ok: true, value: coerced.data }
  const lines = coerced.error.issues.flatMap(describeIssue)
  return {
    ok: false,
    message: `Validation failed for tool "${input.toolName}":\n${
      lines.join('\n') || '  - root: invalid input'
    }\n\nReceived arguments:\n${echoOf(input.raw)}`,
  }
}

type Issue = z.core.$ZodIssue

function pathOf(path: readonly PropertyKey[], leaf?: string): string {
  const parts = path.map(String)
  if (leaf) parts.push(leaf)
  return parts.length > 0 ? parts.join('.') : 'root'
}

const quoted = (values: readonly unknown[]) =>
  values.map((value) => JSON.stringify(value)).join(', ')

/**
 * One line per thing to fix, in the model's terms. Zod already narrows a discriminated union to
 * the branch the call names, so a bad field in an `init` call is reported against `init` alone;
 * an unknown key is named once, plainly; a miss against fixed values lists the values allowed.
 */
function describeIssue(issue: Issue): string[] {
  switch (issue.code) {
    case 'unrecognized_keys':
      return [
        `  - ${pathOf(issue.path)}: unknown parameter${issue.keys.length === 1 ? '' : 's'} ${issue.keys
          .map((key) => `"${key}"`)
          .join(', ')} — not accepted here`,
      ]
    case 'invalid_value':
      return [`  - ${pathOf(issue.path)}: must be one of ${quoted(issue.values)}`]
    case 'invalid_type':
      return [`  - ${pathOf(issue.path)}: must be ${issue.expected}`]
    case 'invalid_union': {
      const discriminated = issue as Issue & { discriminator?: string; options?: unknown[] }
      if (discriminated.options && discriminated.discriminator !== undefined)
        return [`  - ${pathOf(issue.path)}: must be one of ${quoted(discriminated.options)}`]
      // A plain union: the branch that came closest is the one the call meant.
      const closest = [...issue.errors].sort((a, b) => a.length - b.length)[0]
      return closest
        ? closest.flatMap((nested) =>
            describeIssue({ ...nested, path: [...issue.path, ...nested.path] } as Issue),
          )
        : [`  - ${pathOf(issue.path)}: ${issue.message}`]
    }
    case 'too_big':
    case 'too_small':
    case 'invalid_format':
    case 'not_multiple_of':
    case 'invalid_key':
    case 'invalid_element':
    case 'custom':
      return [`  - ${pathOf(issue.path)}: ${issue.message}`]
  }
}

/** The arguments echoed back with a failed call: enough to repair it, never a whole file again. */
const ECHO_LIMIT = 2_000

function echoOf(raw: unknown): string {
  let text: string
  try {
    text = JSON.stringify(raw, null, 2) ?? String(raw)
  } catch {
    text = String(raw)
  }
  if (text.length <= ECHO_LIMIT) return text
  return `${text.slice(0, ECHO_LIMIT)}\n… (${text.length - ECHO_LIMIT} more characters not shown)`
}
