import { expect, test } from 'bun:test'
import { agentDefinitionSchema } from '@localixai/agent/agents'
import { runTurnLimit } from './turn-limit'

const agent = (maxTurns?: number) =>
  agentDefinitionSchema.parse({
    id: 'native:global:worker',
    handle: 'worker',
    description: '',
    instructions: 'Work',
    ...(maxTurns ? { limits: { maxTurns } } : {}),
  })

test('native maxTurns limits every host without raising a smaller host budget', () => {
  expect(runTurnLimit(agent(12))).toBe(12)
  expect(runTurnLimit(agent(12), 5)).toBe(5)
  expect(runTurnLimit(agent(12), 30)).toBe(12)
  expect(runTurnLimit(agent(12), undefined, 7)).toBe(7)
  expect(runTurnLimit(agent(), 30, 7)).toBe(30)
  expect(runTurnLimit(agent())).toBe(1000)
})
