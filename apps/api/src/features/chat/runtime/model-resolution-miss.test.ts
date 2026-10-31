import { describe, expect, test } from 'bun:test'
import { diagnoseModelMiss } from './model-resolution-miss'

describe('why a model could not be bound', () => {
  test('without a catalog, a namespaced id still names the provider to connect', () => {
    const miss = diagnoseModelMiss({
      modelId: 'anthropic/claude-x',
      catalog: undefined,
      connections: [
        { id: 'a', providerId: 'anthropic', keys: [{ enabled: false, priority: 0 }] },
        { id: 'o', providerId: 'openai', keys: [{ enabled: true, priority: 0 }] },
      ],
    })
    expect(miss).toEqual({
      reason: 'no_enabled_key',
      message: 'No enabled key for anthropic. Connect anthropic or enable one of its keys.',
    })
  })

  test('the stored account’s provider is named first among the catalog’s owners', () => {
    const miss = diagnoseModelMiss({
      modelId: 'shared',
      catalog: {
        models: [
          { id: 'shared', providerId: 'first' },
          { id: 'shared', providerId: 'second' },
        ],
        providers: [
          { id: 'first', name: 'First' },
          { id: 'second', name: 'Second' },
        ],
      },
      connections: [{ id: 'mine', providerId: 'second', keys: [] }],
      preferredConnectionId: 'mine',
    })
    expect(miss.message).toBe(
      'No enabled key for Second or First. Connect Second or First or enable one of its keys.',
    )
  })
})
