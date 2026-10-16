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
