import { describe, expect, test } from 'bun:test'

import { USER_PARTICIPANT } from '../../../../db/participant'
import { sessionFixture } from '../../../../testing/session-fixture'
import type { PersistedMessage } from '../../contracts'
import { MAX_HANDOFF_CHAIN } from '../../../../contracts/turn-budget'
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

function harness(options: { session?: typeof room; advice?: string | null } = {}) {
  let session = options.session ?? room
  const queued: Array<{ speaker: string; scope: Partial<RunScope>; triggers: readonly string[] }> =
    []
  const notices: unknown[] = []
  const asked = { count: 0 }
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
    ...(options.advice !== undefined
      ? {
          floorAdvisor: () => async () => {
            asked.count += 1
            return options.advice ?? null
          },
        }
      : {}),
  }
  const route = (
    speaker: string,
    content: string,
    scope: Partial<RunScope> = {},
    history: PersistedMessage[] = [],
    extra: { isInternal?: boolean; passed?: boolean } = {},
  ) =>
    routeConversationReply(
      env as never,
      dispatchParams(
        { userId: session.userId, session, assistantMessageId: 'reply', historyMessages: history },
        { speakerAgentId: speaker, executionContext: sessionExecutionContext(session), ...scope },
      ),
      { content, ...extra },
    )
  return { route, queued, notices, asked, session: () => session }
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

  test('a pass routes nowhere, not even back to the one who named it', async () => {
    const h = harness()
    await h.route('agent-b', '', assignment(), askedBy('agent-a'), { passed: true })
    expect(h.queued).toEqual([])
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

  test('@human is plain text: a finished assignment still reports back to who asked', async () => {
    // The person is reached through `ask`, never a mention, so writing @human ends nothing.
    const h = harness()
    await h.route('agent-b', 'Done; @human may want to look.', assignment(), askedBy('agent-a'))
    expect(h.queued.map((entry) => entry.speaker)).toEqual(['agent-a'])
  })

  test('@human is never routed or invited as an agent', async () => {
    const h = harness()
    await h.route('agent-b', '@human, which language first?')
    expect(h.queued).toEqual([])
    expect(h.session().agents.map((agent) => agent.handle)).not.toContain('human')
  })

  test('@human beside a colleague does not hold the colleague back', async () => {
    const h = harness()
    await h.route('agent-b', '@human, FYI. @qa, verify the checkout flow.')
    expect(h.queued.map((entry) => entry.speaker)).toEqual(['agent-q'])
  })
})

describe('tags bring agents in', () => {
  test('an available agent tagged in a reply joins and answers', async () => {
    const h = harness()
    await h.route('agent-b', '@qa, verify the checkout flow.')
    expect(h.session().agents.map((agent) => agent.handle)).toContain('qa')
    expect(h.queued.map((entry) => entry.speaker)).toEqual(['agent-q'])
  })
})

test('a colleague’s turn in a channel conversation runs under the channel, not the root chat', async () => {
  const h = harness()
  await h.route('agent-a', '@beta, check the order.', {
    executionContext: { invocation: { kind: 'channel' }, authority: { capabilities: [] } },
  })
  expect(h.queued.map((entry) => entry.scope.executionContext)).toEqual([
    { invocation: { kind: 'channel' }, authority: { capabilities: [] } },
  ])
})

test('past the handoff bound nobody is queued and the person is told', async () => {
  const h = harness()
  await h.route('agent-a', '@beta, again.', { handoffDepth: MAX_HANDOFF_CHAIN })
  expect(h.queued).toEqual([])
  expect(h.notices).toHaveLength(1)
})

describe('a decision model corrects the grammar where it is confident', () => {
  test('an @ that only credits a colleague hands the floor back to the person', async () => {
    const h = harness({ advice: 'person' })
    await h.route('agent-a', 'Done — the layout follows what @beta proposed earlier.')
    expect(h.queued).toEqual([])
  })

  test('a handoff by name without an @ reaches that colleague', async () => {
    const h = harness({ advice: 'gamma' })
    await h.route('agent-a', 'The copy is ready. Gamma, please review the legal wording.')
    expect(h.queued.map((turn) => turn.speaker)).toEqual(['agent-c'])
  })

  test('finished work still reports to whoever assigned it, whatever the advice', async () => {
    const h = harness({ advice: 'person' })
    await h.route('agent-b', 'Checked: it holds.', assignment(), askedBy('agent-a'))
    expect(h.queued.map((turn) => turn.speaker)).toEqual(['agent-a'])
  })

  test('a report that stands is not put to the model, nor a chain at its limit', async () => {
    const report = harness({ advice: 'gamma' })
    await report.route('agent-b', 'Checked: it holds.', assignment(), askedBy('agent-a'))
    expect(report.asked.count).toBe(0)
    expect(report.queued.map((turn) => turn.speaker)).toEqual(['agent-a'])

    const limited = harness({ advice: 'gamma' })
    await limited.route('agent-a', 'Gamma, take it from here.', { handoffDepth: MAX_HANDOFF_CHAIN })
    expect(limited.asked.count).toBe(0)
    expect(limited.queued).toEqual([])
  })
})
