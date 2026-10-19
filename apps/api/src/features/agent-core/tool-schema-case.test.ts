import { describe, expect, test } from 'bun:test'
import { z } from 'zod'

import { resolveRunProfile } from './run-shape'
import { richRegistry, SHAPE_SESSION_KIND } from './testing/prompt-render'

/**
 * Every model-facing field is snake_case.
 *
 * The roster used to mix the two — `start_line` beside `startLine`, `snapshotAfter` beside
 * `file_path`, a `history_search` description telling the model to pass `around_message_id`
 * to a schema whose field was `aroundMessageId`. A model that learns one convention from one
 * tool applies it to the next, and the call is refused for an unknown key.
 */
function camelCaseKeys(schema: unknown, path: string, out: string[] = []): string[] {
  if (!schema || typeof schema !== 'object') return out
  const node = schema as Record<string, unknown>
  if (node.properties && typeof node.properties === 'object') {
    for (const [key, child] of Object.entries(node.properties as Record<string, unknown>)) {
      if (/[A-Z]/.test(key)) out.push(`${path}.${key}`)
      camelCaseKeys(child, `${path}.${key}`, out)
    }
  }
  for (const [key, child] of Object.entries(node))
    if (key !== 'properties') camelCaseKeys(child, path, out)
  return out
}

const wireKeysOf = (name: string, schema: z.ZodType) =>
  camelCaseKeys(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }), name)

describe('model-facing field names', () => {
  test('every built-in tool schema, in every run shape, is snake_case', () => {
    const offenders = new Set<string>()
    for (const sessionKind of Object.values(SHAPE_SESSION_KIND)) {
      const registry = richRegistry(resolveRunProfile({ sessionKind }))
      for (const tool of registry.tools)
        for (const key of wireKeysOf(tool.name, tool.inputSchema as z.ZodType)) offenders.add(key)
    }
    expect([...offenders]).toEqual([])
  })

  test('the detector finds a camelCase field, nested or not (positive control)', () => {
    const planted = z.object({
      ok_field: z.string(),
      badField: z.string(),
      steps: z.array(z.object({ nestedBad: z.number() })),
    })
    expect(wireKeysOf('planted', planted).sort()).toEqual([
      'planted.badField',
      'planted.steps.nestedBad',
    ])
  })
})
