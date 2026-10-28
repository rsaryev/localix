import { describe, expect, test } from 'bun:test'

import {
  agentTarget,
  initialPickerTarget,
  isAgentTarget,
  modelPickDestination,
  reasoningMemoryKey,
  targetAgentId,
  workloadKey,
} from './pickerTarget'

describe('picker targets', () => {
  test('an agent target round-trips its ID and never collides with a workload key', () => {
    expect(targetAgentId(agentTarget('builtin:localix'))).toBe('builtin:localix')
    // Every workload key is a bare word, so the prefix is what keeps the two spaces apart —
    // including for an agent whose ID happens to read like one.
    expect(targetAgentId('titleGeneration')).toBeNull()
    expect(targetAgentId(agentTarget('session'))).toBe('session')
    expect(isAgentTarget(agentTarget('session'))).toBe(true)
    expect(isAgentTarget('session')).toBe(false)
  })

  test('only a workload writes to global settings', () => {
    expect(workloadKey('titleGeneration')).toBe('titleGeneration')
    // An agent writes to the conversation, so it has no settings key at all…
    expect(workloadKey(agentTarget('localix'))).toBeNull()
    // …and neither does `session`, which is the reasoning-memory bucket rather than a route.
    expect(workloadKey('session')).toBeNull()
  })

  test('agents share one bucket of per-model reasoning memory', () => {
    // "I like this model on high" is a preference about the model, not about who runs it, so a
    // second agent picking the same model inherits the choice instead of starting from default.
    expect(reasoningMemoryKey(agentTarget('localix'))).toBe('session')
    expect(reasoningMemoryKey(agentTarget('reviewer'))).toBe('session')
    expect(reasoningMemoryKey('titleGeneration')).toBe('titleGeneration')
  })

  test('every picker target has one explicit persistence strategy', () => {
    expect(modelPickDestination('session')).toEqual({ kind: 'conversation' })
    expect(modelPickDestination(agentTarget('reviewer'))).toEqual({
      kind: 'conversation',
      agentId: 'reviewer',
    })
    expect(modelPickDestination('titleGeneration')).toEqual({
      kind: 'workload',
      key: 'titleGeneration',
    })
  })
})

describe('initialPickerTarget', () => {
  test("opens on the conversation's agent, else on the conversation itself", () => {
    expect(initialPickerTarget({ agentId: 'builtin:localix' })).toBe(agentTarget('builtin:localix'))
    expect(initialPickerTarget(undefined)).toBe('session')
  })
})
