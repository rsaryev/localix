import { expect, test } from 'bun:test'
import { sessionFixture } from '../../../../testing/session-fixture'
import { buildParticipantsSection } from '../../../agent-core/prompt/sections/conversation'
import { conversationPromptContext } from './system-prompt-conversation'
import { runPolicyFixture } from '../../../../testing/run-policy-fixture'
import type { SessionRecord } from '../../repository'

/** The prompt context a speaker gets once its run elected a leader from `priorities`. */
const contextFor = (
  session: SessionRecord,
  speakerAgentId: string,
  priorities: ReadonlyMap<string, number>,
) =>
  conversationPromptContext(
    session,
    speakerAgentId,
    runPolicyFixture(session, speakerAgentId, { priorities }),
  )

const solo = sessionFixture()
test('a solo speaker receives election context so it can assemble a team', () => {
  const speaker = solo.agents[0]!
  expect(contextFor(solo, speaker.agentId, new Map([[speaker.agentId, 2]]))).toMatchObject({
    isLeader: true,
    self: speaker.handle,
  })
})
test('the highest current definition priority elects one leader regardless of the handle', () => {
  const a = { ...solo.agents[0]!, agentId: 'native:a', handle: 'planner' }
  const b = { ...a, agentId: 'native:b', handle: 'reviewer' }
  const session = { ...solo, agents: [a, b] }
  const priorities = new Map([
    [a.agentId, -1],
    [b.agentId, 1],
  ])
  expect(contextFor(session, a.agentId, priorities)?.isLeader).toBe(false)
  expect(contextFor(session, b.agentId, priorities)?.isLeader).toBe(true)
  expect(
    conversationPromptContext(session, 'missing', runPolicyFixture(session, a.agentId)),
  ).toBeUndefined()
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
  expect(contextFor(pair, frontend.agentId, priorities)?.leader).toBe('frontend')
  const joined = { ...solo, agents: [frontend, localix] }
  const member = contextFor(joined, frontend.agentId, priorities)!
  expect(member).toMatchObject({ isLeader: false, leader: 'localix' })
  expect(buildParticipantsSection(member)).toContain(
    'The leader is @localix: report to them, and send board or process problems to them.',
  )
  expect(buildParticipantsSection(member)).toContain('- @localix (leader)')
  const leader = contextFor(joined, localix.agentId, priorities)!
  expect(buildParticipantsSection(leader)).toContain('You are the leader.')
  expect(buildParticipantsSection(leader)).not.toContain('(leader)')
})
