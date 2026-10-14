import { afterEach, describe, expect, test } from 'bun:test'

import { routedParticipants, sessionFixture } from '../../../../testing/session-fixture'
import { agentParticipant } from '../../../../db/participant'
import type { PersistedMessage } from '../../contracts'
import { MAX_HANDOFF_CHAIN } from '../../turn-budget'
import type { RunParams } from '../run-contract'
import { createWakeQueue } from '../wake-queue'
import { routeConversationReply } from './conversation-routing'

/**
 * THE TWO LIVE CHATS THE PROTOCOL WAS REWRITTEN FOR, REPLAYED THROUGH THE REAL QUEUE.
 *
 * The model is a script: each turn writes its line and the host routes it exactly as `finalize`
 * does. Everything between — the wake queue, ticket merging, `dispatch-agent` rebuilding the turn
 * trigger, recipient resolution — is production code, so the replay proves the chain end to end.
 */
describe('group chats replayed through the queue', () => {
  const queues: Array<ReturnType<typeof createWakeQueue>> = []
  afterEach(async () => {
    await Promise.all(queues.splice(0).map((queue) => queue.close()))
  })

  /** `null` is the participant's pass (`skip_answer`). */
  function room(handles: string[], script: (handle: string, turn: number) => string | null) {
    const party = handles.map(
      (handle) => routedParticipants({ agentId: `native:global:${handle}`, handle })[0]!,
    )
    const session = sessionFixture({ id: 's1', agents: party })
    const messages: PersistedMessage[] = []
    const turns: Array<{ handle: string; report: boolean; depth: number }> = []
    const notices: unknown[] = []
    const write = (message: PersistedMessage) => {
      const at = messages.findIndex((row) => row.id === message.id)
      if (at >= 0) messages[at] = message
      else messages.push(message)
    }
    const repo = {
      listMessages: async () => [...messages],
      insertMessage: async (message: PersistedMessage) => {
        if ((message.payload as { systemNotice?: unknown }).systemNotice) notices.push(message)
        write(message)
      },
      insertMessages: async (rows: readonly PersistedMessage[]) => rows.forEach(write),
      getMessage: async (_u: string, _s: string, id: string) =>
        messages.find((message) => message.id === id) ?? null,
      getSession: async () => session,
    }
    const deps = {
      streamRegistry: { publish: () => {} },
      listRegistryAgents: async () =>
        party.map((member, index) => ({
          agentId: member.agentId,
          leadershipPriority: index ? 0 : 2,
        })),
    }
    const queue = createWakeQueue({
      repo: repo as never,
      streamRegistry: deps.streamRegistry as never,
      now: () => '2026-10-13T00:00:00.000Z',
      state: { activeRuns: new Map(), drainingSessions: new Set(), sessionRunIdentity: new Map() },
      run: async (params: RunParams) => {
        const handle = session.agents.find((m) => m.agentId === params.scope.speakerAgentId)!.handle
        const line = script(handle, turns.length)
        const content = line ?? ''
        turns.push({
          handle,
          report: params.scope.turnTrigger?.report === true,
          depth: params.scope.handoffDepth ?? 0,
        })
        write({
          id: params.assistantMessageId,
          sessionId: session.id,
          userId: session.userId,
          createdAt: '2026-10-13T00:00:00.000Z',
          updatedAt: '2026-10-13T00:00:00.000Z',
          payload: {
            id: params.assistantMessageId,
            role: 'assistant',
            from: agentParticipant(params.scope.speakerAgentId),
            authorSnapshot: { handle },
            content,
          },
        } as PersistedMessage)
        await routeConversationReply(
          { repo, deps, enqueueRun: queue.enqueueRun } as never,
          { ...params, historyMessages: [...messages] },
          { content, passed: line === null },
        )
        return { status: 'completed' as const }
      },
    })
    queues.push(queue)
    const settle = async (expected: number) => {
      for (let i = 0; i < 600 && turns.length < expected; i++)
        await new Promise((resolve) => setTimeout(resolve, 5))
      // Let a would-be extra turn surface before asserting there is none.
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
    return { queue, session, turns, notices, settle }
  }

  test('LOCALIX-131: an assignment is reported back, and the leader’s summary ends with the person', async () => {
    const r = room(['localix', 'design', 'frontend'], (handle, turn) =>
      handle === 'localix' && turn === 0
        ? '@design, draft the landing mockup at 390 px and 1440 px.'
        : handle === 'design'
          ? 'Mockup ready: preview.html, checked at 390 px and 1440 px.'
          : 'The mockup is ready for your review; approve it and @frontend builds it after.'.replace(
              '@frontend',
              'frontend',
            ),
    )
    await r.queue.wake({
      userId: r.session.userId,
      session: r.session,
      content: 'Let us build a landing page for a phone shop in Cyprus.',
      internal: false,
    })
    await r.settle(3)
    expect(r.turns.map((turn) => turn.handle)).toEqual(['localix', 'design', 'localix'])
    // The design turn was an assignment; the leader's second turn is the report on it.
    expect(r.turns.map((turn) => turn.report)).toEqual([false, false, true])
    expect(r.turns.map((turn) => turn.depth)).toEqual([0, 1, 2])
  })

  test('LOCALIX-132: a circle of players stops at the handoff limit and tells the person', async () => {
    const order = ['localix', 'qa', 'design']
    const r = room(order, (handle) => {
      const next = order[(order.indexOf(handle) + 1) % order.length]
      return `Kazan — next letter N. @${next}, your move.`
    })
    await r.queue.wake({
      userId: r.session.userId,
      session: r.session,
      content: 'Play cities with the others.',
      internal: false,
    })
    await r.settle(MAX_HANDOFF_CHAIN + 1)
    expect(r.turns).toHaveLength(MAX_HANDOFF_CHAIN + 1)
    expect(r.turns.slice(0, 4).map((turn) => turn.handle)).toEqual([
      'localix',
      'qa',
      'design',
      'localix',
    ])
    expect(r.notices).toHaveLength(1)
  })

  test('LOCALIX-185: a specialist named in passing skips, and the round ends with the person', async () => {
    const r = room(['localix', 'gamer'], (handle, turn) => {
      if (handle === 'localix' && turn === 0) return '@gamer, play 2048 to the end.'
      if (handle === 'gamer' && turn === 1) return 'Game over: 3652 points. Play again?'
      if (handle === 'localix')
        return 'Confirmed: 3652 points. Pick a game and I will pass it to @gamer.'
      // Named, asked nothing: the pass.
      return null
    })
    await r.queue.wake({
      userId: r.session.userId,
      session: r.session,
      content: 'Let the gamer play 2048.',
      internal: false,
    })
    await r.settle(4)
    expect(r.turns.map((turn) => turn.handle)).toEqual(['localix', 'gamer', 'localix', 'gamer'])
    expect(r.notices).toHaveLength(0)
  })
})
