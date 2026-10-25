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
      'sessionRecap',
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
      'sessionRecap',
    ])
  })

  test('delegated runs and group routing have no route: agents and availability decide', () => {
    // A delegated run runs on its agent's own model (the agent's Store page); group routing on Jev
    // where OpenRouter is connected, else the embedding model (`floor-advisor.ts`).
    const keys: readonly string[] = AUX_MODEL_TASKS.map((task) => task.key)
    expect(keys).not.toContain('delegation')
    expect(keys).not.toContain('groupRouting')
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

  test('session recaps are on until the person switches them off on their picker row', () => {
    expect(MODEL_ROUTING_TASKS.find((task) => task.key === 'sessionRecap')).toMatchObject({
      toggleable: true,
      fallbackLabel: 'Use session model',
    })
    expect(isModelRoutingTaskEnabled(undefined, 'sessionRecap')).toBe(true)
    expect(
      isModelRoutingTaskEnabled(
        { modelRouting: { sessionRecap: { enabled: false } } },
        'sessionRecap',
      ),
    ).toBe(false)
  })
})
