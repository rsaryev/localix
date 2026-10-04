import { afterEach, describe, expect, test } from 'bun:test'
import { builtinAgentId } from '@localixai/agent/agents'

import { routedParticipants, sessionFixture } from '../../../../testing/session-fixture'
import type { PersistedMessage } from '../../contracts'
import type { RunParams } from '../run-contract'
import { createWakeQueue } from '../wake-queue'

/**
 * A wake that carries the PERSON'S words (`addressedAs` — a plan approval's `@handle`) is routed as
 * the message those words are. Routed as a machine report instead, "@backend, take it" reached
 * the least recently dispatched participant and `@all` reached one agent.
 */
describe('drain — a wake addressed by the person’s words', () => {
  const queues: Array<ReturnType<typeof createWakeQueue>> = []
  afterEach(async () => {
    await Promise.all(queues.splice(0).map((q) => q.close()))
  })

  const party = ['lead', 'backend', 'qa'].map(
    (handle) => routedParticipants({ agentId: builtinAgentId(handle), handle })[0],
  )

  async function speakersFor(addressedAs: string | undefined, expected: number) {
    const session = sessionFixture({ id: 's1', agents: party })
    const messages: PersistedMessage[] = []
    const runs: RunParams[] = []
    const queue = createWakeQueue({
      repo: {
        listMessages: async () => [...messages],
        insertMessage: async (message: PersistedMessage) => {
          messages.push(message)
        },
        insertMessages: async (rows: readonly PersistedMessage[]) => {
          messages.push(...rows)
        },
        getMessage: async (_u: string, _s: string, id: string) =>
          messages.find((message) => message.id === id) ?? null,
        getSession: async () => session,
      } as never,
      streamRegistry: { publish: () => {} } as never,
      now: () => '2026-10-03T00:00:00.000Z',
      state: { activeRuns: new Map(), drainingSessions: new Set(), sessionRunIdentity: new Map() },
      run: async (params: RunParams) => {
        runs.push(params)
        return { status: 'completed' as const }
      },
    })
    queues.push(queue)
    await queue.wake({
      userId: session.userId,
      session,
      content: 'The user approved plan v1. Implement it now.',
      source: 'plan-approved',
      ...(addressedAs !== undefined ? { addressedAs } : {}),
    })
    for (let i = 0; i < 400 && runs.length < expected; i++)
      await new Promise((resolve) => setTimeout(resolve, 5))
    return runs.map((run) => run.scope.speakerAgentId)
  }

  test('a mention addresses that participant, not the least recent one', async () => {
    expect(await speakersFor('@backend take the API part', 1)).toEqual([builtinAgentId('backend')])
  })

  test('@all reaches every participant, as it does for a message', async () => {
    expect((await speakersFor('@all go', 3)).sort()).toEqual(
      ['backend', 'lead', 'qa'].map((handle) => builtinAgentId(handle)).sort(),
    )
  })

  test('no mention: the strategy’s default answerer (the elected lead of a fresh room)', async () => {
    expect(await speakersFor('', 1)).toEqual([builtinAgentId('lead')])
  })

  // Control: the same wake WITHOUT the person's words is a report — one participant, by the
  // runtime rule (least recently dispatched), whatever its content says.
  test('without it, the wake is a report routed to one participant by the runtime rule', async () => {
    expect(await speakersFor(undefined, 1)).toEqual([builtinAgentId('lead')])
  })
})
