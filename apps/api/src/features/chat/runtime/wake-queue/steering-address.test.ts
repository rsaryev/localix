import { afterEach, expect, test } from 'bun:test'

import { sessionFixture } from '../../../../testing/session-fixture'
import { createWakeQueue } from '../wake-queue'

const queues: Array<ReturnType<typeof createWakeQueue>> = []
afterEach(async () => {
  await Promise.all(queues.splice(0).map((q) => q.close()))
})

test('a message for someone else blocks steering rather than being skipped', async () => {
  const session = sessionFixture({ id: 's1' })
  const queue = createWakeQueue({
    repo: {} as never,
    streamRegistry: { publish: () => {} } as never,
    now: () => '2026-09-23T00:00:00.000Z',
    state: {
      activeRuns: new Map([[session.id, new AbortController()]]),
      drainingSessions: new Set(),
      sessionRunIdentity: new Map(),
    },
    run: async () => ({ status: 'completed' as const }),
  })
  queues.push(queue)
  for (const content of ['@qa stop', 'and log it'])
    await queue.wake({
      userId: session.userId,
      session,
      content,
      internal: false,
      source: 'user-busy',
    })

  const notForMe = (content: string) => !content.startsWith('@qa')
  // Taking the second message now would answer it before the first, which is still waiting.
  expect(await queue.reserveSteerable(session.id, notForMe)).toEqual([])
  expect(await queue.reserveSteerable(session.id)).toMatchObject([{ content: '@qa stop' }])
})

test('a child report is leased only for its delegator at an explicit tool seam', async () => {
  const session = sessionFixture({ id: 'child-report-session' })
  const queue = createWakeQueue({
    repo: {} as never,
    streamRegistry: { publish: () => {} } as never,
    now: () => '2026-09-23T00:00:00.000Z',
    state: {
      activeRuns: new Map([[session.id, new AbortController()]]),
      drainingSessions: new Set(),
      sessionRunIdentity: new Map(),
    },
    run: async () => ({ status: 'completed' as const }),
  })
  queues.push(queue)
  await queue.wake({
    userId: session.userId,
    session,
    content: 'child result',
    internal: true,
    source: 'subagent',
    to: { participant: 'agent:parent' },
  })
  expect(await queue.reserveSteerable(session.id)).toEqual([])
  expect(
    await queue.reserveSteerable(session.id, undefined, {
      participant: 'agent:other',
      allowUnaddressed: false,
    }),
  ).toEqual([])
  const taken = await queue.reserveSteerable(session.id, undefined, {
    participant: 'agent:parent',
    allowUnaddressed: false,
  })
  expect(taken).toMatchObject([{ source: 'subagent', content: 'child result' }])
  expect(
    await queue.reserveSteerable(session.id, undefined, {
      participant: 'agent:parent',
      allowUnaddressed: false,
    }),
  ).toEqual([])
  await queue.releaseSteerable(session.id, taken[0]!.id)
  expect(
    await queue.reserveSteerable(session.id, undefined, {
      participant: 'agent:parent',
      allowUnaddressed: false,
    }),
  ).toHaveLength(1)
  expect(await queue.ackSteerable(session.userId, session.id, taken[0]!.id)).toBe(true)
  expect(queue.hasPending(session.id)).toBe(false)
})

test("a queued question's answer joins the run of the participant that asked — and no one else's", async () => {
  const session = sessionFixture({ id: 'answer-session' })
  const queue = createWakeQueue({
    repo: {} as never,
    streamRegistry: { publish: () => {} } as never,
    now: () => '2026-10-02T00:00:00.000Z',
    state: {
      activeRuns: new Map([[session.id, new AbortController()]]),
      drainingSessions: new Set(),
      sessionRunIdentity: new Map(),
    },
    run: async () => ({ status: 'completed' as const }),
  })
  queues.push(queue)
  await queue.wake({
    userId: session.userId,
    session,
    content: '[Answer to q-1] …',
    internal: true,
    source: 'answer',
    to: { participant: 'agent:lead' },
  })
  // Promised as a next-step delivery, like a typed interjection — not a turn of its own.
  expect(queue.list(session.id)).toMatchObject([{ source: 'answer', delivery: 'next-tool' }])
  // A colleague's run does not take an answer to a question it never asked.
  expect(
    await queue.reserveSteerable(session.id, undefined, {
      participant: 'agent:qa',
      allowUnaddressed: true,
    }),
  ).toEqual([])
  expect(
    await queue.reserveSteerable(session.id, undefined, {
      participant: 'agent:lead',
      allowUnaddressed: false,
    }),
  ).toMatchObject([{ source: 'answer', content: '[Answer to q-1] …' }])
})

test('generic wakes never become mid-run steering even with a subagent address', async () => {
  const session = sessionFixture({ id: 'generic-wake-session' })
  const queue = createWakeQueue({
    repo: {} as never,
    streamRegistry: { publish: () => {} } as never,
    now: () => '2026-09-23T00:00:00.000Z',
    state: {
      activeRuns: new Map([[session.id, new AbortController()]]),
      drainingSessions: new Set(),
      sessionRunIdentity: new Map(),
    },
    run: async () => ({ status: 'completed' as const }),
  })
  queues.push(queue)
  await queue.wake({
    userId: session.userId,
    session,
    content: 'another machine wake',
    internal: true,
    source: 'external',
  })
  expect(
    await queue.reserveSteerable(session.id, undefined, {
      participant: 'agent:parent',
      allowUnaddressed: true,
    }),
  ).toEqual([])
  expect(queue.hasPending(session.id)).toBe(true)
})
