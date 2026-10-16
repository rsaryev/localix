import { afterEach, describe, expect, test } from 'bun:test'

import { sessionFixture } from '../../../../testing/session-fixture'
import type { PersistedMessage } from '../../contracts'
import type { RunParams } from '../run-contract'
import { createWakeQueue } from '../wake-queue'

/**
 * A slash command queued while its session was busy must come out of the queue as the same
 * command: the person's row with its badge, and a run carrying the command's own identity.
 */
describe('drain — a queued slash command', () => {
  const queues: Array<ReturnType<typeof createWakeQueue>> = []
  afterEach(async () => {
    await Promise.all(queues.splice(0).map((q) => q.close()))
  })

  test("opens as the person's turn with its badge and its run identity", async () => {
    const session = sessionFixture({ id: 's1' })
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
      now: () => '2026-09-23T00:00:00.000Z',
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
      content: '/sample-command',
      internal: false,
      source: 'user-busy',
      command: {
        origin: { command: '/sample-command', label: 'skill' },
        identity: {
          extraAllowedTools: ['bash'],
          requiredTools: [{ name: 'plugin_build' }],
          modelOverride: 'fast-model',
        },
      },
    })
    for (let i = 0; i < 200 && runs.length === 0; i++) await new Promise((r) => setTimeout(r, 5))

    const userRow = messages.find((message) => message.payload.role === 'user')!
    expect(userRow.payload).toMatchObject({
      from: 'user',
      content: '/sample-command',
      commandOrigin: { command: '/sample-command', label: 'skill' },
    })
    expect(userRow.payload.isInternal).toBeUndefined()
    expect(runs[0]!.scope).toMatchObject({
      extraAllowedTools: ['bash'],
      requiredTools: [{ name: 'plugin_build' }],
      modelOverride: 'fast-model',
      conversationId: userRow.id,
    })
  })
})
