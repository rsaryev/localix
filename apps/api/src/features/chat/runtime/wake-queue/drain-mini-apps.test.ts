import { afterEach, describe, expect, test } from 'bun:test'

import { sessionFixture } from '../../../../testing/session-fixture'
import type { PersistedMessage } from '../../contracts'
import type { RunParams } from '../run-contract'
import { surfaceMiniApps } from '../run/surface-tools'
import { createWakeQueue } from '../wake-queue'

/**
 * A mini app's wake brings its tools on the ROW the turn answers, not on the session: the run reads
 * them back from its own history (`run/surface-tools.ts`). A queue that dropped the field would
 * leave the woken turn to fetch the schema it was woken to use.
 */
describe('drain — a mini app’s wake', () => {
  const queues: Array<ReturnType<typeof createWakeQueue>> = []
  afterEach(async () => {
    await Promise.all(queues.splice(0).map((q) => q.close()))
  })

  test('lands on the hidden row the run answers, and the run reads it back', async () => {
    const session = sessionFixture({ id: 's1' })
    const messages: PersistedMessage[] = []
    const runs: RunParams[] = []
    let started: () => void = () => {}
    const firstRun = new Promise<void>((resolve) => (started = resolve))
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
      now: () => '2026-09-29T00:00:00.000Z',
      state: { activeRuns: new Map(), drainingSessions: new Set(), sessionRunIdentity: new Map() },
      run: async (params: RunParams) => {
        runs.push(params)
        started()
        return { status: 'completed' as const }
      },
    })
    queues.push(queue)

    await queue.wake({
      userId: session.userId,
      session,
      content: 'Your move.',
      source: 'mini-app',
      miniApps: ['fixture-game'],
    })
    await firstRun

    const userRow = messages.find((message) => message.payload.role === 'user')!
    expect(userRow.payload).toMatchObject({ isInternal: true, miniApps: ['fixture-game'] })
    expect(surfaceMiniApps(messages)).toEqual(['fixture-game'])
  })
})
