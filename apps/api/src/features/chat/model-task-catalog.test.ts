import { describe, expect, test } from 'bun:test'
import {
  AUX_MODEL_TASKS,
  MODEL_ROUTING_TASKS,
  MODEL_TASKS,
  isModelRoutingTaskEnabled,
} from './model-task-catalog'

describe('shared model task catalog', () => {
  test('keeps every runtime auxiliary role visible to the model picker', () => {
    expect(AUX_MODEL_TASKS.map((task) => task.key)).toEqual([
      'titleGeneration',
      'inlineCompletion',
      'delegation',
      'groupRouting',
    ])
    expect(MODEL_TASKS[0]).toMatchObject({ key: 'session', required: true })
  })

  test('offers every live route in the rich model drawer, and no board group', () => {
    // The board has no route of its own: a per-agent one was a third copy of the agent roster,
    // and an agent's model lives on its record, where it applies to every dispatch path.
    expect(MODEL_ROUTING_TASKS.map((task) => task.key)).toEqual([
      'session',
      'titleGeneration',
      'inlineCompletion',
      'delegation',
      'groupRouting',
    ])
  })

  test('a workload names the kind of model it runs on; chat when it does not say', () => {
    const kindOf = (key: string) => AUX_MODEL_TASKS.find((t) => t.key === key)
    // On by default: it runs only where a connection serves its model, so connecting OpenRouter
    // turns it on and an explicit off keeps it off.
    expect(kindOf('groupRouting')).toMatchObject({
      modelKind: 'decision',
      defaultModelId: 'openrouter/~typesafe/jev-latest',
    })
    expect(isModelRoutingTaskEnabled(undefined, 'groupRouting')).toBe(true)
    expect(kindOf('delegation')).not.toHaveProperty('modelKind')
  })

  test('reads availability from the same record as the saved model assignment', () => {
    expect(isModelRoutingTaskEnabled(undefined, 'titleGeneration')).toBe(true)
    expect(
      isModelRoutingTaskEnabled(
        { modelRouting: { titleGeneration: { enabled: false } } },
        'titleGeneration',
      ),
    ).toBe(false)
    expect(isModelRoutingTaskEnabled(undefined, 'inlineCompletion')).toBe(false)
    expect(
      isModelRoutingTaskEnabled(
        { modelRouting: { inlineCompletion: { enabled: true } } },
        'inlineCompletion',
      ),
    ).toBe(true)
  })
})
