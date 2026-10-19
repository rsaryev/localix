import { afterEach, expect, test } from 'bun:test'

import { sessionFixture } from '../../../../testing/session-fixture'
import { createWakeQueue } from '../wake-queue'

const queues: Array<ReturnType<typeof createWakeQueue>> = []
const childReport = {
  label: 'Check',
  childSessionId: 'child',
  runId: 'run-1',
  status: 'completed',
  text: 'child result',
}
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
  expect(await queue.reserveSteerable(session.id, { accepts: notForMe })).toEqual([])
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
    report: childReport,
  })
  expect(await queue.reserveSteerable(session.id)).toEqual([])
  expect(
    await queue.reserveSteerable(session.id, {
      reports: { participant: 'agent:other', allowUnaddressed: false },
    }),
  ).toEqual([])
  const taken = await queue.reserveSteerable(session.id, {
    reports: { participant: 'agent:parent', allowUnaddressed: false },
  })
  // Worded from its facts, as every report is when it is delivered (`kinds.ts`).
  expect(taken).toMatchObject([
    { source: 'subagent', content: expect.stringContaining('child result') },
  ])
  expect(
    await queue.reserveSteerable(session.id, {
      reports: { participant: 'agent:parent', allowUnaddressed: false },
    }),
  ).toEqual([])
  await queue.releaseSteerable(session.id, taken[0]!.id)
  expect(
    await queue.reserveSteerable(session.id, {
      reports: { participant: 'agent:parent', allowUnaddressed: false },
    }),
  ).toHaveLength(1)
  expect(await queue.ackSteerable(session.userId, session.id, taken[0]!.id)).toBe(true)
  expect(queue.hasPending(session.id)).toBe(false)
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
    await queue.reserveSteerable(session.id, {
      reports: { participant: 'agent:parent', allowUnaddressed: true },
    }),
  ).toEqual([])
  expect(queue.hasPending(session.id)).toBe(true)
})

test('peeking names the waiting message without leasing it, and skips child reports', async () => {
  const session = sessionFixture({ id: 'peek-session' })
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
  const address = { participant: 'agent:parent', allowUnaddressed: true }
  await queue.wake({
    userId: session.userId,
    session,
    content: 'child result',
    internal: true,
    source: 'subagent',
    to: { participant: 'agent:parent' },
    report: childReport,
  })
  // A report joins only at a completed tool turn; it never preempts calls.
  expect(queue.peekSteerable(session.id, { reports: address })).toBeUndefined()

  const other = sessionFixture({ id: 'peek-user' })
  await queue.wake({
    userId: other.userId,
    session: other,
    content: 'wait, use the staging database',
    internal: false,
    source: 'user-busy',
  })
  const waiting = queue.peekSteerable(other.id)
  expect(waiting).toBeString()
  expect(queue.peekSteerable(other.id)).toBe(waiting!)
  const [taken] = await queue.reserveSteerable(other.id)
  expect(taken?.id).toBe(waiting!)
  expect(queue.peekSteerable(other.id)).toBeUndefined()
})

test("the person's message joins a run from the surface it was sent on, and only that one", async () => {
  const session = sessionFixture({ id: 'surface-session' })
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
  const workbench = { capabilities: ['workbench-ui'], catalogs: { 'workbench-ui': 'cat-1' } }
  await queue.wake({
    userId: session.userId,
    session,
    content: 'use staging',
    internal: false,
    source: 'user-busy',
    toolSurface: workbench,
  })
  // Every send from the app carries its surface. It used to keep every interjection off the run.
  expect(await queue.list(session.id)).toMatchObject([{ delivery: 'next-tool' }])
  const elsewhere = { capabilities: ['workbench-ui'], catalogs: { 'workbench-ui': 'cat-2' } }
  expect(await queue.reserveSteerable(session.id, { surface: elsewhere })).toEqual([])
  expect(await queue.reserveSteerable(session.id, { surface: workbench })).toMatchObject([
    { content: 'use staging' },
  ])
})

test('every report to the running delegator is taken as one reservation, acknowledged as one', async () => {
  const session = sessionFixture({ id: 'report-batch-session' })
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
  for (const child of ['a', 'b'])
    await queue.wake({
      userId: session.userId,
      session,
      content: `${child} report`,
      source: 'subagent',
      to: { participant: 'agent:parent' },
      report: { ...childReport, label: child, childSessionId: child, text: `${child} done` },
    })
  const reports = { participant: 'agent:parent', allowUnaddressed: false }
  const [taken, ...rest] = await queue.reserveSteerable(session.id, { reports })
  expect(rest).toEqual([])
  expect(taken?.content).toStartWith('[2 delegated task reports]')
  expect(await queue.reserveSteerable(session.id, { reports })).toEqual([])
  expect(await queue.ackSteerable(session.userId, session.id, taken!.id)).toBe(true)
  expect(await queue.list(session.id)).toEqual([])
})
