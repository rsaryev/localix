import { afterEach, describe, expect, it } from 'bun:test'
import {
  acknowledgeReportedTrace,
  resetUnreportedFailuresForTests,
  scheduleUnreportedFailure,
  startUnreportedFailurePublisher,
} from './incidentFallback'

afterEach(resetUnreportedFailuresForTests)

const failure = {
  traceId: 'q1',
  summary: 'interact failed',
  title: 'Could not send your answer',
  origin: { kind: 'session' as const, sessionId: 'LOCALIX-18', projectId: null },
  ts: 1_000,
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 5))

describe('unreported incident fallback', () => {
  it('publishes a mutation failure when its call site stays silent', async () => {
    const seen: string[] = []
    startUnreportedFailurePublisher((event) => seen.push(event.traceId))
    scheduleUnreportedFailure(failure, 0)
    await flush()
    expect(seen).toEqual(['q1'])
  })

  it('cancels the generic fallback when a durable event contains the failed trace', async () => {
    const seen: string[] = []
    startUnreportedFailurePublisher((event) => seen.push(event.traceId))
    scheduleUnreportedFailure(failure, 0)
    acknowledgeReportedTrace([
      {
        id: 'step-1',
        traceId: 'q1',
        phase: 'failed',
        kind: 'rpc.interact',
        summary: 'interact failed',
        origin: failure.origin,
        ts: 1_000,
      },
    ])
    await flush()
    expect(seen).toEqual([])
  })

  it('one reported failure covers its siblings in the same scope — and nothing else', async () => {
    const seen: string[] = []
    startUnreportedFailurePublisher((event) => seen.push(event.traceId))
    // A batch of three deletes failed; the row reports the batch, its trace names only the newest.
    scheduleUnreportedFailure({ ...failure, traceId: 'd1', ts: 1_000 }, 0)
    scheduleUnreportedFailure({ ...failure, traceId: 'd2', ts: 1_050 }, 0)
    scheduleUnreportedFailure({ ...failure, traceId: 'd3', ts: 1_100 }, 0)
    // Another session's failure, and one of this session's long before, are different facts.
    scheduleUnreportedFailure(
      { ...failure, traceId: 'other', origin: { ...failure.origin, sessionId: 'LOCALIX-2' } },
      0,
    )
    scheduleUnreportedFailure({ ...failure, traceId: 'earlier', ts: 1_000 - 60_000 }, 0)
    acknowledgeReportedTrace([
      {
        id: 'step-3',
        traceId: 'd3',
        phase: 'failed',
        kind: 'rpc.delete',
        summary: 'delete failed',
        origin: failure.origin,
        ts: 1_100,
      },
    ])
    await flush()
    expect(seen.sort()).toEqual(['earlier', 'other'])
  })
})
