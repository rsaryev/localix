import { expect, test } from 'bun:test'
import { sessionFixture } from '../../../../testing/session-fixture'
import { conversationPromptContext } from './system-prompt-conversation'

const solo = sessionFixture()
test('a solo speaker receives election context so it can assemble a team', () => {
  const speaker = solo.agents[0]!
  expect(
    conversationPromptContext(solo, speaker.agentId, new Map([[speaker.agentId, 2]])),
  ).toMatchObject({ isLeader: true, self: speaker.handle })
})
test('the highest current definition priority elects one leader regardless of the handle', () => {
  const a = { ...solo.agents[0]!, agentId: 'native:a', handle: 'planner' }
  const b = { ...a, agentId: 'native:b', handle: 'reviewer' }
  const session = { ...solo, agents: [a, b] }
  const priorities = new Map([
    [a.agentId, -1],
    [b.agentId, 1],
  ])
  expect(conversationPromptContext(session, a.agentId, priorities)?.isLeader).toBe(false)
  expect(conversationPromptContext(session, b.agentId, priorities)?.isLeader).toBe(true)
  expect(conversationPromptContext(session, 'missing', priorities)).toBeUndefined()
})
