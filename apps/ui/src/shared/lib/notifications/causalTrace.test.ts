import { beforeEach, describe, expect, it } from 'bun:test'
import {
  addEventTraceStep,
  causalTraceSnapshot,
  eventTraceSnapshot,
  resetEventTrace,
  traceOrigin,
} from './trace'

beforeEach(resetEventTrace)

const session = { kind: 'session' as const, sessionId: 'LOCALIX-215', projectId: 'PRJ-9' }

/**
 * The shipped defect, from a real Event Center row (seq 6862): a DevOps "Docker returned an
 * error." row carried `GET kubernetes failed` (a 503 poll) as its trace. The Docker request had
 * failed three seconds earlier and was in the buffer; the newest-failure-in-ten-seconds rule cut it.
 */
function dockerThenKubernetesPolls() {
  addEventTraceStep({
    traceId: 'h100',
    kind: 'http.get',
    summary: 'GET docker failed',
    phase: 'failed',
    origin: session,
    attributes: { path: '/rpc/acme', status: 400 },
  })
  for (const id of ['h121', 'h122', 'h124']) {
    addEventTraceStep({
      traceId: id,
      kind: 'http.get',
      summary: 'GET kubernetes failed',
      phase: 'failed',
      origin: session,
      attributes: { path: '/rpc/globex', status: 503 },
    })
  }
}

describe('a named cause decides the trace', () => {
  it('the guess picks the newest nearby failure — the wrong one (why causes exist)', () => {
    dockerThenKubernetesPolls()
    expect(eventTraceSnapshot(8, session).map((step) => step.traceId)).toEqual(['h124'])
  })

  it('a problem that names its request gets exactly that request, marked as the cause', () => {
    dockerThenKubernetesPolls()
    const trace = causalTraceSnapshot(['h100'])
    expect(trace).toHaveLength(1)
    expect(trace[0]).toMatchObject({
      traceId: 'h100',
      summary: 'GET docker failed',
      attributes: { status: 400, cause: true },
    })
  })

  it('a cause no longer in the buffer yields nothing, never a substitute', () => {
    dockerThenKubernetesPolls()
    expect(causalTraceSnapshot(['h999'])).toEqual([])
  })

  it("the cause's origin is where the row is filed", () => {
    addEventTraceStep({
      traceId: 'h7',
      kind: 'http.get',
      summary: 'GET docker failed',
      phase: 'failed',
      origin: { ...session, label: 'DevOps' },
    })
    expect(traceOrigin(['h7'])).toMatchObject({ sessionId: 'LOCALIX-215', label: 'DevOps' })
  })
})
