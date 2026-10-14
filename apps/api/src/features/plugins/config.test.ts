import { describe, expect, test } from 'bun:test'
import { resolvePluginConfig, declaredConfigKeys } from './config'
import type { PluginManifest } from './contracts'

const manifest = (config: Record<string, { default?: unknown }>): PluginManifest =>
  ({ config }) as unknown as PluginManifest

describe('resolvePluginConfig', () => {
  test('applies declared defaults', () => {
    const out = resolvePluginConfig(manifest({ A: { default: 'x' }, B: { default: 5 } }), undefined)
    expect(out).toEqual({ A: 'x', B: 5 })
  })

  test('stored values override defaults (stored wins)', () => {
    const out = resolvePluginConfig(manifest({ A: { default: 'x' } }), { A: 'override', C: true })
    expect(out).toEqual({ A: 'override', C: true })
  })

  test('options with no default are omitted unless stored', () => {
    expect(resolvePluginConfig(manifest({ A: {} }), undefined)).toEqual({})
    expect(resolvePluginConfig(manifest({ A: {} }), { A: 'set' })).toEqual({ A: 'set' })
  })

  test('no config + no stored → empty', () => {
    expect(resolvePluginConfig(manifest({}), undefined)).toEqual({})
  })
})

describe('declaredConfigKeys', () => {
  test('returns exactly the declared config keys (env-access gate)', () => {
    const keys = declaredConfigKeys(manifest({ TOKEN: {}, PATH: { default: '/x' } }))
    expect([...keys].sort()).toEqual(['PATH', 'TOKEN'])
    expect(keys.has('UNDECLARED')).toBe(false)
  })
  test('no config → empty set', () => {
    expect(declaredConfigKeys(manifest({})).size).toBe(0)
  })
})
