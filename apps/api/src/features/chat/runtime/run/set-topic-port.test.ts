import { describe, expect, test } from 'bun:test'

import { USER_PARTICIPANT } from '../../../../db/participant'
import { sessionFixture } from '../../../../testing/session-fixture'
import type { SessionTopic } from '../../../agent-core/session-topic'
import type { PersistedMessage } from '../../contracts'
import { sessionExecutionContext } from '../execution-context'
import { dispatchParams } from '../run-params'
import { createSetTopicPort, topicBoundary } from './set-topic-port'

const row = (id: string, from: string): PersistedMessage =>
  ({ id, payload: { id, role: from === USER_PARTICIPANT ? 'user' : 'assistant', from } }) as never

const topic: SessionTopic = {
  title: 'Landing',
  goal: 'Build the Cyprus phone shop landing.',
  previousTopicSummary: 'No previous topic.',
}

const base = sessionFixture({
  agents: [
    {
      agentId: 'lead',
      handle: 'lead',
      providerConnectionId: null,
      modelId: '',
      reasoningEffort: 'medium',
    },
    {
      agentId: 'dev',
      handle: 'dev',
      providerConnectionId: null,
      modelId: '',
      reasoningEffort: 'medium',
    },
  ],
})

function harness(speaker: string, history: PersistedMessage[]) {
  let session = base
  const boundaries: unknown[] = []
  const port = createSetTopicPort(
    {
      repo: {
        getSession: async () => session,
        updateSessionTopic: async (
          _u: string,
          _id: string,
          _expected: unknown,
          next: SessionTopic,
          _at: string,
          boundary?: { messageId: string },
        ) => {
          session = { ...session, ...next }
          boundaries.push(boundary)
          return true
        },
      },
      deps: {
        listRegistryAgents: async () => [
          { agentId: 'lead', leadershipPriority: 2 },
          { agentId: 'dev', leadershipPriority: 0 },
        ],
        streamRegistry: { publish: () => {} },
      },
    } as never,
    dispatchParams(
      { userId: base.userId, session: base, assistantMessageId: 'reply', historyMessages: history },
      { speakerAgentId: speaker, executionContext: sessionExecutionContext(base) },
    ),
  )
  return { port, boundaries, session: () => session }
}

describe('set_topic', () => {
  test('the boundary sits before the request that opens the topic, so the turn keeps its work', async () => {
    const history = [
      row('u1', USER_PARTICIPANT),
      row('a1', 'agent:lead'),
      row('u2', USER_PARTICIPANT),
    ]
    expect(topicBoundary(history)).toBe('a1')
    const h = harness('lead', history)
    await h.port.save('call', topic)
    expect(h.boundaries).toEqual([{ messageId: 'a1' }])
    expect(h.session().goal).toBe(topic.goal)
  })

  test('a topic opened by the first message cuts nothing', async () => {
    const h = harness('lead', [row('u1', USER_PARTICIPANT)])
    await h.port.save('call', topic)
    expect(h.boundaries).toEqual([undefined])
  })

  test('once per turn, and only by the leader', async () => {
    const lead = harness('lead', [row('u1', USER_PARTICIPANT)])
    await lead.port.save('call', topic)
    await expect(lead.port.save('again', topic)).rejects.toThrow(/already set/)
    const dev = harness('dev', [row('u1', USER_PARTICIPANT)])
    await expect(dev.port.save('call', topic)).rejects.toThrow(/leader/)
  })
})
