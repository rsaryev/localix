import { describe, expect, it } from 'bun:test'
import { modelIdFromCmdkValue, modelRefFromCmdkValue } from './cmdkHighlight'

describe('modelIdFromCmdkValue', () => {
  it('returns null for empty / whitespace / nullish', () => {
    expect(modelIdFromCmdkValue(undefined)).toBeNull()
    expect(modelIdFromCmdkValue(null)).toBeNull()
    expect(modelIdFromCmdkValue('')).toBeNull()
    expect(modelIdFromCmdkValue('   ')).toBeNull()
  })

  it('passes through a single-connection row value (bare model id)', () => {
    expect(modelIdFromCmdkValue('openai/gpt-4o')).toBe('openai/gpt-4o')
    expect(modelIdFromCmdkValue('claude-3-5-sonnet')).toBe('claude-3-5-sonnet')
  })

  it('extracts the model id from a cross-connection row value ("<connectionId> <modelId>")', () => {
    expect(modelIdFromCmdkValue('conn-123 anthropic/claude-3-5-sonnet')).toBe(
      'anthropic/claude-3-5-sonnet',
    )
    expect(modelIdFromCmdkValue('7f3c9e0a-uuid openai/gpt-4o')).toBe('openai/gpt-4o')
  })

  it('trims a cmdk-trimmed value defensively', () => {
    expect(modelIdFromCmdkValue('  conn-1 model-x  ')).toBe('model-x')
  })
})

describe('modelRefFromCmdkValue', () => {
  it('keeps the exact connection for cross-connection rows', () => {
    expect(modelRefFromCmdkValue('work-account shared-model')).toEqual({
      connectionId: 'work-account',
      modelId: 'shared-model',
    })
    expect(modelRefFromCmdkValue('shared-model')).toEqual({ modelId: 'shared-model' })
  })
})
