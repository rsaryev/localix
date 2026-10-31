import { expect, test } from 'bun:test'
import { agentModelSettingsFor, setAgentModelSettings } from './agent-model-settings'

test('parameters stay isolated by agent, provider and model while preserving sibling parameters', () => {
  const entries = [
    { agentId: 'a', providerId: 'p', modelId: 'm', maxTurns: 5, effort: 'high' as const },
    { agentId: 'b', providerId: 'p', modelId: 'm', maxTurns: 20 },
    { agentId: 'a', providerId: 'q', modelId: 'm', maxTurns: 100 },
  ]
  const changed = setAgentModelSettings(entries, {
    agentId: 'a',
    providerId: 'p',
    modelId: 'm',
    maxTurns: 7,
  })
  expect(agentModelSettingsFor(changed, 'a', 'p', 'm')).toMatchObject({
    maxTurns: 7,
    effort: 'high',
  })
  expect(agentModelSettingsFor(changed, 'b', 'p', 'm')).toEqual(entries[1])
  expect(agentModelSettingsFor(changed, 'a', 'q', 'm')).toEqual(entries[2])
  expect(agentModelSettingsFor(changed, 'a', 'p', 'other')).toBeUndefined()
  const reset = setAgentModelSettings(changed, {
    agentId: 'a',
    providerId: 'p',
    modelId: 'm',
    maxTurns: undefined,
  })
  expect(agentModelSettingsFor(reset, 'a', 'p', 'm')).toMatchObject({ effort: 'high' })
  expect(agentModelSettingsFor(reset, 'a', 'p', 'm')?.maxTurns).toBeUndefined()
})

test('the list keeps the newest 200 entries and drops the oldest', () => {
  const entries = Array.from({ length: 200 }, (_, i) => ({
    agentId: `a${i}`,
    providerId: 'p',
    modelId: 'm',
    maxTurns: 5,
  }))
  const next = setAgentModelSettings(entries, {
    agentId: 'new',
    providerId: 'p',
    modelId: 'm',
    maxTurns: 9,
  })
  expect(next).toHaveLength(200)
  expect(next[0]?.agentId).toBe('new')
  expect(agentModelSettingsFor(next, 'a199', 'p', 'm')).toBeUndefined()
  expect(agentModelSettingsFor(next, 'a198', 'p', 'm')).toBeDefined()
})
