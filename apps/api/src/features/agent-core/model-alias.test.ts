import { describe, expect, test } from 'bun:test'
import { bestModelForFamily, resolveModelAlias } from './model-alias'

const CATALOG = [
  'anthropic/claude-3-5-sonnet',
  'anthropic/claude-sonnet-4-5',
  'anthropic/claude-opus-4-1',
  'anthropic/claude-3-5-haiku',
  'openai/gpt-4o',
]

describe('resolveModelAlias', () => {
  test('inherit / undefined / empty → parent model', () => {
    expect(resolveModelAlias(undefined, 'parent-model')).toBe('parent-model')
    expect(resolveModelAlias('inherit', 'parent-model')).toBe('parent-model')
    expect(resolveModelAlias('  INHERIT ', 'parent-model')).toBe('parent-model')
    expect(resolveModelAlias('', 'parent-model')).toBe('parent-model')
  })

  test('inherit with no parent model → undefined', () => {
    expect(resolveModelAlias('inherit', undefined)).toBeUndefined()
    expect(resolveModelAlias(undefined, undefined)).toBeUndefined()
  })

  test('alias family resolves to newest matching catalog id', () => {
    expect(resolveModelAlias('sonnet', 'parent', CATALOG)).toBe('anthropic/claude-sonnet-4-5')
    expect(resolveModelAlias('opus', 'parent', CATALOG)).toBe('anthropic/claude-opus-4-1')
    expect(resolveModelAlias('haiku', 'parent', CATALOG)).toBe('anthropic/claude-3-5-haiku')
    expect(resolveModelAlias('Sonnet', 'parent', CATALOG)).toBe('anthropic/claude-sonnet-4-5')
  })

  test('alias family with no catalog / no match → parent model', () => {
    expect(resolveModelAlias('sonnet', 'parent-model')).toBe('parent-model')
    expect(resolveModelAlias('fable', 'parent-model', CATALOG)).toBe('parent-model')
    expect(resolveModelAlias('opus', 'parent-model', ['openai/gpt-4o'])).toBe('parent-model')
  })

  test('concrete model id passes through verbatim', () => {
    expect(resolveModelAlias('anthropic/claude-3-5-sonnet', 'parent', CATALOG)).toBe(
      'anthropic/claude-3-5-sonnet',
    )
    expect(resolveModelAlias('some-custom/model-x', 'parent')).toBe('some-custom/model-x')
  })

  test('bestModelForFamily prefers highest version groups', () => {
    expect(bestModelForFamily('sonnet', CATALOG)).toBe('anthropic/claude-sonnet-4-5')
    expect(bestModelForFamily('opus', CATALOG)).toBe('anthropic/claude-opus-4-1')
    // "no catalog id matches the family → undefined". This used to say 'gemini',
    // which is not a ModelAliasFamily at all — an input the function can never be
    // handed, so the branch it claimed to cover was never reachable from this call.
    // `fable` IS a family, and this CATALOG has no fable model: same branch, real input.
    expect(bestModelForFamily('fable', CATALOG)).toBeUndefined()
  })
})

describe('bestModelForFamily date stamps', () => {
  test('a release date stamp never outranks a newer version number', () => {
    const ids = ['claude-opus-4-20250514', 'claude-opus-4-5', 'claude-opus-4-1-20250805']
    expect(bestModelForFamily('opus', ids)).toBe('claude-opus-4-5')
  })

  test('the date stamp breaks a tie between equal versions', () => {
    const ids = ['claude-sonnet-4-5', 'claude-sonnet-4-5-20250929']
    expect(bestModelForFamily('sonnet', ids)).toBe('claude-sonnet-4-5-20250929')
  })
})
