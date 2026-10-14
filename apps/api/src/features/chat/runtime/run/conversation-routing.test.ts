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
    extra: { isInternal?: boolean; handoffs?: string[] } = {},
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

describe('a turn hands the floor with handoff', () => {
  test('each addressed colleague answers once, in order, reading the reply as its brief', async () => {
    const h = harness()
    await h.route('agent-a', 'Gamma designs it, then beta builds it; keep it small.', {}, [], {
      handoffs: ['gamma', 'beta'],
    })
    expect(h.queued.map((entry) => entry.speaker)).toEqual(['agent-c', 'agent-b'])
    expect(h.queued[0]!.triggers).toEqual(['reply'])
    expect(h.queued[0]!.scope.turnTrigger).toEqual({
      kind: 'colleague-request',
      messageIds: ['reply'],
    })
    expect(h.queued[0]!.scope.handoffDepth).toBe(1)
  })

  test('an @handle in prose assigns nothing, whatever it says or where it stands', async () => {
    const h = harness()
    await h.route(
      'agent-a',
      [
        '@beta has no new task: the game is over.',
        'Run `@gamma deploy` later.',
        '> @beta said so',
      ].join('\n'),
    )
    expect(h.queued).toEqual([])
  })

  test('the speaker itself, the person and a stranger are not handed the floor', async () => {
    const h = harness()
    await h.route('agent-a', 'Ready.', {}, [], { handoffs: ['alpha', 'user', 'nobody'] })
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
    await h.route('agent-b', 'Done.', assignment(), askedBy('agent-a'), { handoffs: ['alpha'] })
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

describe('a handoff brings agents in', () => {
  test('an available agent handed the floor joins and answers', async () => {
    const h = harness()
    await h.route('agent-b', 'Verify the checkout flow.', {}, [], { handoffs: ['qa'] })
    expect(h.session().agents.map((agent) => agent.handle)).toContain('qa')
    expect(h.queued.map((entry) => entry.speaker)).toEqual(['agent-q'])
  })

  test('tagging an absent available agent invites it with the floor, as it always did', async () => {
    const h = harness()
    await h.route('agent-b', '@qa, verify the checkout flow.')
    expect(h.session().agents.map((agent) => agent.handle)).toContain('qa')
    expect(h.queued.map((entry) => entry.speaker)).toEqual(['agent-q'])
  })

  test('tagging a participant who is already here stays a reference', async () => {
    const h = harness()
    await h.route('agent-b', '@alpha has the plan; @qa, verify it.')
    expect(h.queued.map((entry) => entry.speaker)).toEqual(['agent-q'])
  })

  test('a room the person fixed does not grow from a handoff', async () => {
    const h = harness({ session: { ...room, rosterLocked: true } })
    await h.route('agent-a', 'Verify it.', {}, [], { handoffs: ['qa'] })
    expect(h.session().agents).toHaveLength(3)
    expect(h.queued).toEqual([])
  })
})

test('past the handoff bound nobody is queued and the person is told', async () => {
  const h = harness()
  await h.route('agent-a', 'Again.', { handoffDepth: MAX_HANDOFF_CHAIN }, [], {
    handoffs: ['beta'],
  })
  expect(h.queued).toEqual([])
  expect(h.notices).toHaveLength(1)
})
