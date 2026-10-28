import { describe, expect, test } from 'bun:test'
import { agentFileSchema } from '@localixai/agent/agents'
import {
  createFormatAdapterRegistry,
  type FormatAdapter,
  type FormatDiagnostic,
} from './format-adapter'

const definition = { name: 'reviewer', instructions: 'Review changes.', description: '' }
const input = { format: 'fixture.json', version: 1, source: 'installation/artifact', text: '{}' }
const json: FormatAdapter = {
  format: input.format,
  version: input.version,
  decode: (text) => ({ value: JSON.parse(text), diagnostics: [] }),
}

describe('format adapter boundary', () => {
  test('two independent formats produce the same strict native definition', () => {
    const registry = createFormatAdapterRegistry(agentFileSchema)
    registry.register(json)
    registry.register({
      format: 'fixture.lines',
      version: 2,
      decode(text) {
        const [name, instructions] = text.split('\n')
        return {
          value: { name, instructions, description: '' },
          diagnostics: [
            {
              field: 'line:2',
              status: 'translated',
              impact: 'execution',
              message: 'Instruction line translated',
            },
          ],
        }
      },
    })
    const a = registry.decode({ ...input, text: JSON.stringify(definition) })
    const b = registry.decode({
      ...input,
      format: 'fixture.lines',
      version: 2,
      text: 'reviewer\nReview changes.',
    })
    expect(a.status).toBe('accepted')
    expect(b.status).toBe('accepted')
    if (a.status !== 'accepted' || b.status !== 'accepted') throw new Error('Expected acceptance')
    expect(a.value).toEqual(b.value)
    expect(Object.keys(b.value).sort()).toEqual(['description', 'instructions', 'name'])
    expect(b.source).toBe(input.source)
    expect(b.diagnostics[0]?.status).toBe('translated')
  })

  test('foreign fields and adapter-issued identity cannot enter an authored agent file', () => {
    const registry = createFormatAdapterRegistry(agentFileSchema)
    registry.register(json)
    for (const extra of [
      { permissionMode: 'bypassPermissions' },
      { tools: ['bash'] },
      { id: 'forged' },
    ]) {
      const result = registry.decode({
        ...input,
        text: JSON.stringify({ ...definition, ...extra }),
      })
      expect(result.status).toBe('rejected')
      expect('value' in result).toBe(false)
    }
  })

  test('unsupported authority and execution constraints reject otherwise valid output', () => {
    for (const impact of ['authority', 'execution'] as const) {
      const registry = createFormatAdapterRegistry(agentFileSchema)
      registry.register({
        ...json,
        decode: () => ({
          value: definition,
          diagnostics: [
            { field: 'constraint', status: 'unsupported', impact, message: 'No implementation' },
          ],
        }),
      })
      expect(registry.decode(input)).toMatchObject({ status: 'rejected' })
      expect('value' in registry.decode(input)).toBe(false)
    }
  })

  test('an unsupported presentation hint remains visible without contaminating the definition', () => {
    const registry = createFormatAdapterRegistry(agentFileSchema)
    const diagnostic: FormatDiagnostic = {
      field: 'color',
      status: 'unsupported',
      impact: 'presentation',
      message: 'Color is not imported',
    }
    registry.register({ ...json, decode: () => ({ value: definition, diagnostics: [diagnostic] }) })
    expect(registry.decode(input)).toMatchObject({
      status: 'accepted',
      value: definition,
      diagnostics: [diagnostic],
    })
  })

  test('unknown formats and versions cannot try another registered decoder', () => {
    const registry = createFormatAdapterRegistry(agentFileSchema)
    let calls = 0
    registry.register({
      ...json,
      decode: () => {
        calls++
        return { value: definition, diagnostics: [] }
      },
    })
    expect(registry.decode({ ...input, version: 2 }).status).toBe('rejected')
    expect(registry.decode({ ...input, format: 'other' }).status).toBe('rejected')
    expect(calls).toBe(0)
  })

  test('stale unload cannot remove a replacement registration', () => {
    const registry = createFormatAdapterRegistry(agentFileSchema)
    const dispose = registry.register(json)
    expect(() => registry.register(json)).toThrow('already registered')
    dispose()
    expect(registry.decode(input).status).toBe('rejected')
    registry.register(json)
    dispose()
    expect(registry.decode({ ...input, text: JSON.stringify(definition) }).status).toBe('accepted')
  })

  test('decoding limits count bytes and reject before executing adapter code', () => {
    const registry = createFormatAdapterRegistry(agentFileSchema, 3)
    let called = false
    registry.register({
      ...json,
      decode: () => {
        called = true
        throw new Error('private data')
      },
    })
    expect(registry.decode({ ...input, text: '😀' }).diagnostics[0]?.message).toContain(
      'size limit',
    )
    expect(called).toBe(false)
    const failed = registry.decode(input)
    expect(failed.status).toBe('rejected')
    expect(JSON.stringify(failed)).not.toContain('private data')
  })
})
