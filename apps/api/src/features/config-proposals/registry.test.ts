/**
 * The remedy registry as the MODEL sees it: one discriminated union, and a schema the model
 * can actually satisfy.
 *
 * The second test is the one with a scar. `z.boolean().default(true)` reads as "optional with
 * a default", but the JSON Schema generated from it lists the field as REQUIRED — zod's
 * default belongs to the parsed output, not to the input the model is asked for. So every
 * "defaulted" field silently became mandatory, and a model that omitted it had its call
 * rejected by validation before the tool ran. Defaults on a model-facing schema are applied
 * on READ instead.
 */
import { describe, expect, test } from 'bun:test'
import { zodToJsonSchema } from '@localixai/agent'

import { createRemedyRegistry, REMEDIES } from './registry'

type JsonSchema = {
  oneOf?: JsonSchema[]
  anyOf?: JsonSchema[]
  properties?: Record<string, unknown>
  required?: string[]
}

const branches = (): JsonSchema[] => {
  const schema = zodToJsonSchema(createRemedyRegistry().changeSchema) as JsonSchema
  return schema.oneOf ?? schema.anyOf ?? []
}

describe('the remedy registry', () => {
  test('is one union with a branch per remedy, discriminated by kind', () => {
    expect(branches()).toHaveLength(REMEDIES.length)
    const kinds = branches().map(
      (branch) => (branch.properties?.kind as { const?: string } | undefined)?.const,
    )
    // Both sides sort with an explicit comparator: the default sort is by UTF-16 code unit, which
    // is only the same order for ASCII ids and would compare two differently-ordered lists the day
    // one is not.
    const byText = (a: string, b: string) => a.localeCompare(b)
    expect(kinds.filter((kind): kind is string => Boolean(kind)).sort(byText)).toEqual(
      REMEDIES.map((remedy) => remedy.id).sort(byText),
    )
  })

  test('requires no field that carries a default — a default is not a requirement', () => {
    const offenders = branches().flatMap((branch) => {
      const kind = (branch.properties?.kind as { const?: string } | undefined)?.const ?? '?'
      return (branch.required ?? [])
        .filter((field) => field !== 'kind')
        .flatMap((field) => {
          const property = branch.properties?.[field] as { default?: unknown } | undefined
          return property && 'default' in property ? [`${kind}.${field}`] : []
        })
    })
    expect(offenders).toEqual([])
  })

  test('every remedy resolves its own change, and an unknown kind is refused', () => {
    const registry = createRemedyRegistry()
    expect(registry.remedyIdOf({ kind: 'tool.enable', name: 'loops' })).toBe('tool.enable')
    expect(() => registry.remedyIdOf({ kind: 'nope' })).toThrow()
  })

  // Installing, enabling and removing a plugin, mini app or MCP server is the Store's (`store`),
  // where the person sees what it runs; `configure` only asks for access to a tool.
  test('offers no remedy for a plugin, a mini app or an MCP server', () => {
    const registry = createRemedyRegistry()
    for (const kind of ['plugin.enable', 'mini-app.enable', 'mcp.server.enable'])
      expect(() => registry.remedyIdOf({ kind, name: 'x' })).toThrow()
    expect(REMEDIES.map((remedy) => remedy.id)).toEqual(['tool.enable'])
  })
})
