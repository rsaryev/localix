import { describe, expect, test } from 'bun:test'
import { effortForModelSwitch, reasoningForModel, reasoningOnModel } from './reasoning-levels'

const opus = { supportsReasoning: true, reasoningEfforts: ['low', 'medium', 'high', 'max'] }

describe('reasoningOnModel — the one rule for the picker, /model and the server', () => {
  test('the running model keeps its level, clamped to what it offers', () => {
    expect(reasoningOnModel(opus, 'xhigh', 'low')).toBe('max')
    expect(reasoningOnModel(opus, 'off', undefined)).toBe('low')
  })

  test('another model starts at the remembered level, else the default', () => {
    expect(reasoningOnModel(opus, undefined, 'high')).toBe('high')
    expect(reasoningOnModel(opus, undefined, undefined)).toBe('medium')
  })

  test('a model that does not reason is off, whatever was asked', () => {
    expect(reasoningOnModel({ supportsReasoning: false }, 'high', 'max')).toBe('off')
    expect(reasoningForModel('high', { supportsReasoning: false })).toBe('off')
  })

  test('the server switch is the same rule', () => {
    const previous = { modelId: 'opus', reasoningEffort: 'xhigh' as const }
    expect(effortForModelSwitch({ previous, next: { id: 'opus', ...opus } })).toBe(
      reasoningOnModel(opus, 'xhigh', undefined),
    )
    expect(
      effortForModelSwitch({ previous, next: { id: 'other', ...opus }, remembered: 'low' }),
    ).toBe(reasoningOnModel(opus, undefined, 'low'))
  })
})
