import { describe, expect, test } from 'bun:test'
import {
  modelReasoningFor,
  normalizeModelReasoningPreferences,
  removeModelReasoningFromList,
  setModelReasoningInList,
  type ModelReasoningPreference,
} from './modelReasoningPreferences'

const initial: ModelReasoningPreference[] = [
  { providerId: 'anthropic', modelId: 'claude-opus', effort: 'high' },
  { providerId: 'openrouter', modelId: 'claude-opus', effort: 'low' },
]

describe('model reasoning preferences', () => {
  test('keys effort by provider and model inside one workload route', () => {
    expect(modelReasoningFor(initial, 'anthropic', 'claude-opus')).toBe('high')
    expect(modelReasoningFor(initial, 'openrouter', 'claude-opus')).toBe('low')
    expect(modelReasoningFor(initial, 'anthropic', 'claude-sonnet')).toBeUndefined()
  })

  test('updates one pair without changing another provider', () => {
    const next = setModelReasoningInList(initial, {
      providerId: 'anthropic',
      modelId: 'claude-opus',
      effort: 'max',
    })

    expect(next).toEqual([
      {
        providerId: 'anthropic',
        modelId: 'claude-opus',
        effort: 'max',
      },
      {
        providerId: 'openrouter',
        modelId: 'claude-opus',
        effort: 'low',
      },
    ])
  })

  test('can remove one provider/model memory without touching another', () => {
    expect(removeModelReasoningFromList(initial, 'anthropic', 'claude-opus')).toEqual([
      { providerId: 'openrouter', modelId: 'claude-opus', effort: 'low' },
    ])
  })

  test('normalizes server data to one deterministic entry per provider/model pair', () => {
    expect(
      normalizeModelReasoningPreferences([
        { providerId: 'anthropic', modelId: 'claude-opus', effort: 'high' },
        { providerId: 'anthropic', modelId: 'claude-opus', effort: 'low' },
        { providerId: '', modelId: 'invalid', effort: 'max' },
      ]),
    ).toEqual([{ providerId: 'anthropic', modelId: 'claude-opus', effort: 'high' }])
  })
})
