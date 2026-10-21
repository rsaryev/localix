import { expect, test } from 'bun:test'
import { createPriorityQueue } from '../../../../lib/priority-queue'
import { sessionFixture } from '../../../../testing/session-fixture'
import { createDrainOperations } from './drain'
import type { PendingTurn } from './entry'
import { createWakeQueueSharedState } from './leases'
import type { RunExecutionOutcome } from '../run-outcome'

function fixture(failure?: 'ack' | 'remove' | 'publish') {
  const trace: string[] = []
  const outcomes: RunExecutionOutcome[] = []
  const session = sessionFixture({ id: 's1', closedAt: '2026-10-09T00:00:00Z' })
  const shared = createWakeQueueSharedState({ activeRuns: new Map(), drainingSessions: new Set() })
  const q = createPriorityQueue<PendingTurn>()
  // Two wakes of one stream: delivered as one band (`kinds.ts`, `coalesce`).
  for (const id of ['a', 'b'])
    q.enqueue(
      {
        entry: 'event',
        coalesce: 'feed',
        source: 'bg-monitor',
        userId: session.userId,
        content: id,
        internal: true,
        kind: 'wake',
        queuedAt: '',
      },
      { id },
    )
  const remove = q.remove.bind(q)
  q.remove = (id) => {
    trace.push(`remove:${id}`)
    if (id === 'b' && failure === 'remove') throw new Error('remove failed')
    return remove(id)
  }
  shared.queues.set(session.id, q)
  const drain = createDrainOperations(shared, {
    ready: Promise.resolve(),
    repo: { getSession: async () => session },
    leases: {
      claim: async () => {
        trace.push('claim')
        return true
      },
      ack: async () => {
        trace.push('ack')
        return failure !== 'ack'
      },
      release: async () => {
        trace.push('release')
      },
      releaseDrainBand: () => {
        trace.push('release-band')
      },
      resetDrainRetry: () => {
        trace.push('reset-retry')
      },
      scheduleDrainRetry: () => {
        trace.push('schedule-retry')
      },
      keepAlive: () => () => {},
    },
    deadLetter: { recordFailure: async () => false, delivered: () => {} },
    continuations: {
      settleCompletion: (_ids: string[], outcome: RunExecutionOutcome) => {
        trace.push('settle')
        outcomes.push(outcome)
      },
    },
    publishQueue: () => {
      trace.push('publish')
      if (failure === 'publish') throw new Error('publish failed')
    },
    onError: (error: unknown) => {
      trace.push(`error:${(error as Error).message}`)
    },
    holdsOf: () => ({ ids: new Set() }),
    holdUntil: () => {},
  } as never)
  return { trace, outcomes, q, shared, drain, session }
}

async function run(f: ReturnType<typeof fixture>) {
  try {
    await f.drain.drainPendingAndRun(f.session.id)
    expect(f.shared.drainingSessions.size).toBe(0)
    expect(f.shared.inFlightDrains.size).toBe(0)
  } finally {
    f.drain.close()
  }
}

test('closed-session dismissal retires the whole acknowledged band before publishing', async () => {
  const f = fixture()
  await run(f)
  expect(f.trace).toEqual([
    'claim',
    'ack',
    'remove:a',
    'remove:b',
    'reset-retry',
    'release-band',
    'publish',
    'settle',
  ])
  expect(f.q.size()).toBe(0)
  expect(f.outcomes).toMatchObject([{ status: 'failed', kind: 'dismissed', retryable: false }])
})

test('a failed acknowledgement leaves delivery queued and completion pending for retry', async () => {
  const f = fixture('ack')
  await run(f)
  expect(f.trace).toEqual([
    'claim',
    'ack',
    'release',
    'release-band',
    'error:Delivery lost its durable lease',
    'schedule-retry',
  ])
  expect(f.q.list().map((item) => item.id)).toEqual(['a', 'b'])
  expect(f.outcomes).toEqual([])
})

test('a partially removed band keeps its remaining retry owner and skips publishing', async () => {
  const f = fixture('remove')
  await run(f)
  expect(f.trace).toEqual([
    'claim',
    'ack',
    'remove:a',
    'remove:b',
    'release',
    'release-band',
    'error:remove failed',
    'schedule-retry',
  ])
  expect(f.q.list().map((item) => item.id)).toEqual(['b'])
  expect(f.outcomes).toEqual([])
})

test('a publishing failure after retirement settles terminally without restoring queued work', async () => {
  const f = fixture('publish')
  await run(f)
  expect(f.q.size()).toBe(0)
  expect(f.trace).toEqual([
    'claim',
    'ack',
    'remove:a',
    'remove:b',
    'reset-retry',
    'release-band',
    'publish',
    'release',
    'release-band',
    'error:publish failed',
    'settle',
    'schedule-retry',
  ])
  expect(f.outcomes).toEqual([
    {
      status: 'failed',
      kind: 'fatal',
      message: 'publish failed',
      retryable: false,
      rateLimited: false,
    },
  ])
})
