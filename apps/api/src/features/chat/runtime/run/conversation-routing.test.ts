import { describe, expect, test } from 'bun:test'

import { USER_PARTICIPANT } from '../../../../db/participant'
import { sessionFixture } from '../../../../testing/session-fixture'
import type { PersistedMessage } from '../../contracts'
import { MAX_HANDOFF_CHAIN } from '../../turn-budget'
import { sessionExecutionContext } from '../execution-context'
import { dispatchParams } from '../run-params'
import type { RunScope } from '../run-contract'
import { routeConversationReply } from './conversation-routing'

const member = (agentId: string, handle: string) => ({
  agentId,
  handle,
  providerConnectionId: null,
  modelId: '',
  reasoningEffort: 'medium' as const,
})

const room = sessionFixture({
  agents: [member('agent-a', 'alpha'), member('agent-b', 'beta'), member('agent-c', 'gamma')],
})

const row = (id: string, from: string, content = ''): PersistedMessage =>
  ({
    id,
    payload: { id, role: from === USER_PARTICIPANT ? 'user' : 'assistant', from, content },
  }) as never

function harness(options: { session?: typeof room } = {}) {
  let session = options.session ?? room
  const queued: Array<{ speaker: string; scope: Partial<RunScope>; triggers: readonly string[] }> =
    []
  const notices: unknown[] = []
  const env = {
    repo: {
      getSession: async () => session,
      updateMembership: async (_u: string, _id: string, agents: typeof session.agents) => {
        session = { ...session, agents }
        return true
      },
      insertMessage: async (message: unknown) => {
        notices.push(message)
      },
    },
    enqueueRun: async (next: { scope: RunScope; triggerMessageIds: readonly string[] }) => {
      queued.push({
        speaker: next.scope.speakerAgentId,
        scope: next.scope,
        triggers: next.triggerMessageIds,
      })
    },
    deps: {
      listRegistryAgents: async () => [
        { agentId: 'agent-a', leadershipPriority: 2 },
        { agentId: 'agent-b', leadershipPriority: 0 },
        { agentId: 'agent-c', leadershipPriority: 0 },
      ],
      listInvocableRegistryAgents: async () => [
        { agentId: 'agent-q', name: 'qa', description: 'Quality' },
      ],
      streamRegistry: { publish: () => {} },
    },
  }
  const route = (
    speaker: string,
    content: string,
    scope: Partial<RunScope> = {},
    history: PersistedMessage[] = [],
    extra: { isInternal?: boolean } = {},
  ) =>
    routeConversationReply(
      env as never,
      dispatchParams(
        { userId: session.userId, session, assistantMessageId: 'reply', historyMessages: history },
        { speakerAgentId: speaker, executionContext: sessionExecutionContext(session), ...scope },
      ),
      { content, ...extra },
    )
  return { route, queued, notices, session: () => session }
}

const assignment = (): Partial<RunScope> => ({
  turnTrigger: { kind: 'colleague-request', messageIds: ['ask'] },
  handoffDepth: 1,
})
const askedBy = (agentId: string) => [row('ask', `agent:${agentId}`, '@beta, check it.')]

describe('a reply hands the floor by addressing colleagues', () => {
  test('each addressed colleague answers once, in order, reading the reply as its brief', async () => {
    const h = harness()
    await h.route('agent-a', '@gamma, design it; @beta, then build it. @gamma, keep it small.')
    expect(h.queued.map((entry) => entry.speaker)).toEqual(['agent-c', 'agent-b'])
    expect(h.queued[0]!.triggers).toEqual(['reply'])
    expect(h.queued[0]!.scope.turnTrigger).toEqual({
      kind: 'colleague-request',
      messageIds: ['reply'],
    })
    expect(h.queued[0]!.scope.handoffDepth).toBe(1)
  })

  test('code, quotes, links and the speaker itself are references, not addresses', async () => {
    const h = harness()
    await h.route(
      'agent-a',
      [
        'Run `@beta deploy` later.',
        '```',
        '@gamma in a block',
        '```',
        '> @beta said so',
        'See [notes](https://x.test/@gamma) — @alpha will continue.',
      ].join('\n'),
    )
    expect(h.queued).toEqual([])
  })

  test('a reply to the person addresses nobody and ends with the person', async () => {
    const h = harness()
    await h.route('agent-a', 'The page is ready; please review it.')
    expect(h.queued).toEqual([])
  })
})

describe('assignments and reports', () => {
  test('finished work that addresses nobody is reported to whoever assigned it', async () => {
    const h = harness()
    await h.route(
      'agent-b',
      'Done: index.html, verified at 390 px.',
      assignment(),
      askedBy('agent-a'),
    )
    expect(h.queued.map((entry) => entry.speaker)).toEqual(['agent-a'])
    expect(h.queued[0]!.scope.turnTrigger?.report).toBe(true)
    expect(h.queued[0]!.scope.handoffDepth).toBe(2)
  })

  test('a silent turn on an assignment still reaches the one who asked', async () => {
    const h = harness()
    await h.route('agent-b', '', assignment(), askedBy('agent-a'), { isInternal: true })
    expect(h.queued.map((entry) => entry.speaker)).toEqual(['agent-a'])
  })

  test('addressing the one who assigned the turn is a report', async () => {
    const h = harness()
    await h.route('agent-b', '@alpha, done.', assignment(), askedBy('agent-a'))
    expect(h.queued[0]!.scope.turnTrigger?.report).toBe(true)
  })

  test('a reply to a report that addresses nobody ends with the person, not the reporter', async () => {
    const h = harness()
    await h.route(
      'agent-a',
      'Everything is verified; the landing is ready.',
      { turnTrigger: { kind: 'colleague-request', messageIds: ['ask'], report: true } },
      askedBy('agent-b'),
    )
    expect(h.queued).toEqual([])
  })

  test('a question to the person is not reported back', async () => {
    const h = harness()
    await h.route('agent-b', '@user, which language first?', assignment(), askedBy('agent-a'))
    expect(h.queued).toEqual([])
  })
})

describe('tags bring agents in', () => {
  test('an available agent tagged in a reply joins and answers', async () => {
    const h = harness()
    await h.route('agent-b', '@qa, verify the checkout flow.')
    expect(h.session().agents.map((agent) => agent.handle)).toContain('qa')
    expect(h.queued.map((entry) => entry.speaker)).toEqual(['agent-q'])
  })

  test('a room the person fixed does not grow from a tag', async () => {
    const h = harness({ session: { ...room, rosterLocked: true } })
    await h.route('agent-a', '@qa, verify it.')
    expect(h.session().agents).toHaveLength(3)
    expect(h.queued).toEqual([])
  })
})

test('past the handoff bound nobody is queued and the person is told', async () => {
  const h = harness()
  await h.route('agent-a', '@beta, again.', { handoffDepth: MAX_HANDOFF_CHAIN })
  expect(h.queued).toEqual([])
  expect(h.notices).toHaveLength(1)
})
