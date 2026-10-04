import { describe, expect, test } from 'bun:test'
import {
  assignTaskModel,
  assignTaskReasoning,
  resolveLiveTaskModel,
  selectedTaskModelId,
} from './taskReasoning'

describe('task-aware reasoning settings', () => {
  test('changing a model restores the effort belonging to the new provider/model pair', () => {
    expect(
      assignTaskModel(
        { providerConnectionId: 'old', modelId: 'old-model', reasoningEffort: 'high' },
        'new',
        'new-model',
        'low',
      ),
    ).toEqual({ providerConnectionId: 'new', modelId: 'new-model', reasoningEffort: 'low' })
  })

  test('a model without a saved effort inherits from the session', () => {
    expect(
      assignTaskModel(
        { providerConnectionId: 'old', modelId: 'old-model', reasoningEffort: 'high' },
        'new',
        'new-model',
      ),
    ).toEqual({ providerConnectionId: 'new', modelId: 'new-model' })
  })

  test('setting and inheriting effort preserve model assignment', () => {
    const slot = { providerConnectionId: 'connection', modelId: 'model' } as const
    expect(assignTaskReasoning(slot, 'max')).toEqual({ ...slot, reasoningEffort: 'max' })
    expect(assignTaskReasoning({ ...slot, reasoningEffort: 'max' }, undefined)).toEqual(slot)
  })

  test('reset slots remain reset', () => {
    expect(assignTaskReasoning(null, 'high')).toBeNull()
  })

  test('rebinds a stale connection through the namespaced model provider', () => {
    const live = { id: 'live-openai', providerId: 'openai' }
    const resolved = resolveLiveTaskModel(
      [{ id: 'openai/gpt-5.6', name: 'GPT 5.6', providerId: 'openai' }],
      [live],
      { providerConnectionId: 'deleted-openai', modelId: 'openai/gpt-5.6' },
    )

    expect(resolved?.connection).toBe(live)
    expect(resolved?.model.id).toBe('openai/gpt-5.6')
  })

  test('does not guess when a bare model id is ambiguous across providers', () => {
    expect(
      resolveLiveTaskModel(
        [
          { id: 'shared', name: 'Shared A', providerId: 'a' },
          { id: 'shared', name: 'Shared B', providerId: 'b' },
        ],
        [
          { id: 'a-live', providerId: 'a' },
          { id: 'b-live', providerId: 'b' },
        ],
        { providerConnectionId: 'deleted', modelId: 'shared' },
      ),
    ).toBeNull()
  })

  test('marks the active participant model rather than the first session model', () => {
    const reviewer = {
      connection: { id: 'shared-connection' },
      model: { id: 'reviewer-model' },
    }

    expect(selectedTaskModelId(reviewer, 'shared-connection')).toBe('reviewer-model')
    expect(selectedTaskModelId(reviewer, 'another-connection')).toBe('')
  })
})
