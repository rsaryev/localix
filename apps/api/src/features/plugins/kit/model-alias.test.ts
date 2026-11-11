import { describe, expect, test } from 'bun:test'
import { bestModelForFamily, modelAliasResolver } from './model-alias'

const resolve: typeof modelAliasResolver.resolve = (...args) => modelAliasResolver.resolve(...args)
const CATALOG = [
  'anthropic/claude-3-5-sonnet',
  'anthropic/claude-sonnet-4-5',
  'anthropic/claude-opus-4-1',
  'anthropic/claude-3-5-haiku',
  'openai/gpt-4o',
]

describe('modelAliasResolver', () => {
  test('inherit or no value is the parent model', () => {
    expect(resolve(undefined, 'parent-model')).toBe('parent-model')
    expect(resolve('inherit', 'parent-model')).toBe('parent-model')
    expect(resolve(' inherit ', 'parent-model')).toBe('parent-model')
    expect(resolve('', 'parent-model')).toBe('parent-model')
    expect(resolve('inherit', undefined)).toBeUndefined()
  })

  test('an alias is the newest offered model of its family', () => {
    expect(resolve('sonnet', 'parent', CATALOG)).toBe('anthropic/claude-sonnet-4-5')
    expect(resolve('opus', 'parent', CATALOG)).toBe('anthropic/claude-opus-4-1')
    expect(resolve('haiku', 'parent', CATALOG)).toBe('anthropic/claude-3-5-haiku')
  })

  test('an alias no offered model is of falls back to the parent, never the alias word', () => {
    expect(resolve('sonnet', 'parent-model')).toBe('parent-model')
    expect(resolve('fable', 'parent-model', CATALOG)).toBe('parent-model')
    expect(resolve('opus', 'parent-model', ['openai/gpt-4o'])).toBe('parent-model')
  })

  test('a full id passes through, as the kit reads any other value (case included)', () => {
    expect(resolve('anthropic/claude-3-5-sonnet', 'parent', CATALOG)).toBe(
      'anthropic/claude-3-5-sonnet',
    )
    expect(resolve('some-custom/model-x', 'parent')).toBe('some-custom/model-x')
    expect(resolve('Sonnet', 'parent', CATALOG)).toBe('Sonnet')
  })

  // sub-agents.md, "Choose a model": the subagent "runs on the main conversation's exact model,
  // including any `[1m]` suffix" when that model belongs to the alias's family.
  test('an alias of the parent model’s own family keeps the parent’s exact model', () => {
    const catalog = ['claude-opus-4-1', 'claude-opus-5-5', 'claude-sonnet-5']
    expect(resolve('opus', 'claude-opus-4-1[1m]', catalog)).toBe('claude-opus-4-1[1m]')
    expect(resolve('sonnet', 'claude-opus-4-1', catalog)).toBe('claude-sonnet-5')
  })

  test('a family is the one the id names as a part, not any substring', () => {
    expect(resolve('opus', 'parent', ['vendor/magnumopus-9', 'claude-opus-4'])).toBe(
      'claude-opus-4',
    )
  })
})

describe('bestModelForFamily', () => {
  test('prefers the highest version groups', () => {
    expect(bestModelForFamily('sonnet', CATALOG)).toBe('anthropic/claude-sonnet-4-5')
    expect(bestModelForFamily('fable', CATALOG)).toBeUndefined()
  })

  test('a release date stamp never outranks a newer version number', () => {
    const ids = ['claude-opus-4-20250514', 'claude-opus-4-5', 'claude-opus-4-1-20250805']
    expect(bestModelForFamily('opus', ids)).toBe('claude-opus-4-5')
  })

  test('the date stamp breaks a tie between equal versions', () => {
    const ids = ['claude-sonnet-4-5', 'claude-sonnet-4-5-20250929']
    expect(bestModelForFamily('sonnet', ids)).toBe('claude-sonnet-4-5-20250929')
  })
})
