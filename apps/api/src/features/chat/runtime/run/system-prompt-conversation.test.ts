import { expect, test } from 'bun:test'
import { sessionFixture } from '../../../../testing/session-fixture'
import { buildParticipantsSection } from '../../../agent-core/system-prompt-conversation-section'
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

test('every speaker’s roster names the current leader, and a stronger arrival takes over', () => {
  const route = solo.agents[0]!
  const frontend = { ...route, agentId: 'native:frontend', handle: 'frontend' }
  const localix = { ...route, agentId: 'native:localix', handle: 'localix' }
  const priorities = new Map([
    [frontend.agentId, 0],
    [localix.agentId, 2],
  ])
  const pair = { ...solo, agents: [frontend] }
  expect(conversationPromptContext(pair, frontend.agentId, priorities)?.leader).toBe('frontend')
  const joined = { ...solo, agents: [frontend, localix] }
  const member = conversationPromptContext(joined, frontend.agentId, priorities)!
  expect(member).toMatchObject({ isLeader: false, leader: 'localix' })
  expect(buildParticipantsSection(member)).toContain(
    'The leader is @localix: report to them, and send board or process problems to them.',
  )
  expect(buildParticipantsSection(member)).toContain('- @localix (leader)')
  const leader = conversationPromptContext(joined, localix.agentId, priorities)!
  expect(buildParticipantsSection(leader)).toContain('You are the leader.')
  expect(buildParticipantsSection(leader)).not.toContain('(leader)')
})
