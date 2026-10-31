import { describe, expect, it } from 'bun:test'
import { modelRefFromCmdkValue } from './cmdkHighlight'

describe('modelRefFromCmdkValue', () => {
  it('returns null for empty / whitespace / nullish', () => {
    expect(modelRefFromCmdkValue(undefined)).toBeNull()
    expect(modelRefFromCmdkValue(null)).toBeNull()
    expect(modelRefFromCmdkValue('')).toBeNull()
    expect(modelRefFromCmdkValue('   ')).toBeNull()
  })

  it('passes through a single-connection row value (bare model id)', () => {
    expect(modelRefFromCmdkValue('openai/gpt-4o')).toEqual({ modelId: 'openai/gpt-4o' })
  })

  it('keeps the exact connection for cross-connection rows, trimming the value', () => {
    expect(modelRefFromCmdkValue('work-account shared-model')).toEqual({
      connectionId: 'work-account',
      modelId: 'shared-model',
    })
    expect(modelRefFromCmdkValue('  conn-1 model-x  ')).toEqual({
      connectionId: 'conn-1',
      modelId: 'model-x',
    })
  })
})
