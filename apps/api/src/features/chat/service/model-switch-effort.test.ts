import { describe, expect, test } from 'bun:test'
import { clampEffortToModel, effortForModelSwitch } from './model-switch-effort'

describe('effortForModelSwitch (/model)', () => {
  const previous = { modelId: 'openai/strong', reasoningEffort: 'xhigh' as const }

  test("another model never inherits the previous model's level", () => {
    expect(effortForModelSwitch({ previous, next: { id: 'openrouter/haiku' } })).toBe('medium')
  })

  test('another model starts at the level remembered for this agent on it', () => {
    expect(
      effortForModelSwitch({ previous, next: { id: 'openrouter/haiku' }, remembered: 'low' }),
    ).toBe('low')
  })

  test('the same model keeps the seat level', () => {
    expect(effortForModelSwitch({ previous, next: { id: 'openai/strong' } })).toBe('xhigh')
  })

  test('the stored level is one the model offers', () => {
    expect(
      effortForModelSwitch({
        previous,
        next: { id: 'openai/strong', supportsReasoning: true, reasoningEfforts: ['low', 'high'] },
      }),
    ).toBe('high')
  })

  test('a model that does not reason stores off, as the picker does', () => {
    expect(
      effortForModelSwitch({ previous, next: { id: 'plain', supportsReasoning: false } }),
    ).toBe('off')
  })
})

describe('clampEffortToModel', () => {
  test('walks up first, then down, like the runtime', () => {
    expect(clampEffortToModel('medium', { reasoningEfforts: ['low', 'high'] })).toBe('high')
    expect(clampEffortToModel('max', { reasoningEfforts: ['low', 'high'] })).toBe('high')
  })

  test('Off stays only where it is real', () => {
    expect(clampEffortToModel('off', { reasoningEfforts: ['off', 'high'] })).toBe('off')
    // A model that cannot switch thinking off runs Off at its lowest level.
    expect(clampEffortToModel('off', { reasoningEfforts: ['low', 'high'] })).toBe('low')
    expect(clampEffortToModel('minimal', {})).toBe('minimal')
    expect(clampEffortToModel('off', {})).toBe('off')
  })

  test('a non-reasoning model, or one that publishes no level, stores off', () => {
    expect(clampEffortToModel('high', { supportsReasoning: false })).toBe('off')
    expect(clampEffortToModel('high', { reasoningEfforts: [] })).toBe('off')
  })
})
