import { afterEach, expect, test } from 'bun:test'

import { sessionFixture } from '../../../../testing/session-fixture'
import { createWakeQueue } from '../wake-queue'
import { createSelfWakeBudget, MAX_CONSECUTIVE_SELF_WAKES } from './self-wake-budget'

/**
 * A delegator's message (`delegate` action message) reaches its child either way: a running child
 * takes it at its next step, an idle child runs for it. Pinned on the real queue, because the two paths are
 * owned by different readers (steering and the drain) and a child that could only be reached one
 * way is exactly the one-shot child this replaced.
 */

const queues: Array<ReturnType<typeof createWakeQueue>> = []
afterEach(async () => {
  await Promise.all(queues.splice(0).map((q) => q.close()))
})

function childQueue(running: boolean, closedAt: string | null = null) {
  const session = sessionFixture({ id: `child-${running}`, sessionKind: 'subagent', closedAt })
  const runs: string[] = []
  // Every write a drained wake makes on its way to `run` is accepted and forgotten, so a drained
  // message actually reaches `run`.
  const reads: Record<string, unknown> = {
    getSession: async () => session,
    listMessages: async () => [],
    getMessage: async () => null,
  }
  const repo = new Proxy(reads, {
    get: (target, key) => target[key as string] ?? (async () => undefined),
  })
  const queue = createWakeQueue({
    repo: repo as never,
    streamRegistry: { publish: () => {} } as never,
    now: () => '2026-10-01T00:00:00.000Z',
    state: {
      activeRuns: new Map(running ? [[session.id, new AbortController()]] : []),
      drainingSessions: new Set(),
      sessionRunIdentity: new Map(),
    },
    onError: (error) => {
      throw error
    },
    // Only THAT a run started matters here, never what it was given.
    run: async () => {
      runs.push('run')
      return { status: 'completed' as const }
    },
  })
  queues.push(queue)
  const say = (content: string) =>
    queue.wake({ userId: session.userId, session, content, internal: true, source: 'delegator' })
  return { session, queue, runs, say }
}

test('a running child takes it at its next step, with no participant address needed', async () => {
  const { session, queue, say } = childQueue(true)
  await say('the endpoint moved to /v2')
  expect(await queue.reserveSteerable(session.id)).toMatchObject([
    { source: 'delegator', content: 'the endpoint moved to /v2', internal: true },
  ])
})

test('an idle child runs for it — a finished child is reachable, not one-shot', async () => {
  const { session, queue, runs, say } = childQueue(false)
  await say('now add tests')
  for (let i = 0; i < 100 && runs.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  expect(runs).toEqual(['run'])
  expect(await queue.list(session.id)).toEqual([])
})

test('a CLOSED child is never woken: the drain dismisses the wake instead of running it', async () => {
  // Its close clears the queue, but a wake admitted a moment before the mark still reaches the
  // drain — the one door every queued turn passes. The test above is the positive control: the
  // same harness DOES run an open child.
  const { session, queue, runs, say } = childQueue(false, '2026-10-01T00:00:00.000Z')
  await say('are you there?')
  await queue.drainPendingAndRun(session.id)
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(runs).toEqual([])
  expect(await queue.list(session.id)).toEqual([])
})

test('the composer is told it arrives mid-run, the same fact steering acts on', async () => {
  const { session, queue, say } = childQueue(true)
  await say('noted')
  expect((await queue.list(session.id))[0]?.delivery).toBe('next-tool')
})

test('it counts toward the self-caused chain, so parent and child cannot ping-pong forever', () => {
  // Every run of a child reports, a report can prompt a message, and that message runs the child
  // again: `subagent` bounds the parent's side of the loop, `delegator` the child's.
  const budget = createSelfWakeBudget()
  const admitted = Array.from({ length: MAX_CONSECUTIVE_SELF_WAKES + 1 }, () => {
    const ok = budget.admit('child', { internal: true, source: 'delegator' })
    budget.admit('child', { internal: true, agentTurn: { source: 'runtime' } })
    return ok
  })
  expect(admitted.slice(0, MAX_CONSECUTIVE_SELF_WAKES).every(Boolean)).toBe(true)
  expect(admitted.at(-1)).toBe(false)
})
