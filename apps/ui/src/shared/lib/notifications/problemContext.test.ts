import { afterEach, describe, expect, it } from 'bun:test'

import { publishProblemReport } from './problems'
import { resetNotificationsForTests, useNotificationsStore } from './store'
import { addEventTraceStep, resetEventTrace } from './trace'

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const origin = { kind: 'session' as const, sessionId: 'LOCALIX-215', projectId: 'PRJ-9' }

afterEach(() => {
  resetNotificationsForTests()
  resetEventTrace()
})

/**
 * What a row says about a failed request, end to end from the mini app's problem to the stored
 * entry.
 *
 * Before: the body read `engine_error — Docker returned an error.` (the code printed as a location,
 * the title twice) and the trace was a Kubernetes poll that happened to fail last.
 */
describe('a problem that names its request', () => {
  it('files that request as the cause, and nothing nearby', async () => {
    addEventTraceStep({
      traceId: 'h100',
      kind: 'http.get',
      summary: 'GET docker failed',
      phase: 'failed',
      origin,
      attributes: { path: '/rpc/acme', status: 503 },
    })
    addEventTraceStep({
      traceId: 'h124',
      kind: 'http.get',
      summary: 'GET kubernetes failed',
      phase: 'failed',
      origin,
      attributes: { path: '/rpc/globex', status: 503 },
    })
    publishProblemReport(
      {
        subject: { label: 'Docker' },
        problems: [
          {
            message: 'Docker is not running',
            code: 'engine_unavailable',
            request: {
              method: 'GET',
              path: '/rpc/acme/items',
              status: 503,
              traceId: 'h100',
              requestId: 'a1b2c3d4e5f6',
            },
          },
        ],
        consequence: 'blocked',
      },
      { scope: 'devops' },
    )
    await settle()
    const entry = useNotificationsStore.getState().entries[0]!

    expect(entry.trace?.map((step) => step.traceId)).not.toContain('h124')
    expect(entry.trace?.find((step) => step.traceId === 'h100')?.attributes?.cause).toBe(true)
    // The code is context, not a location in front of the sentence.
    expect(entry.message).not.toContain('engine_unavailable —')
    expect(entry.message).toContain(
      'engine_unavailable · GET /rpc/acme/items → 503 · request a1b2c3d4e5f6',
    )
  })

  it('rebuilds the step from the request when it left the buffer', async () => {
    publishProblemReport(
      {
        subject: { label: 'Docker' },
        problems: [
          {
            message: 'Docker is not running',
            request: { method: 'GET', path: '/rpc/acme/items', status: 503, traceId: 'gone' },
          },
        ],
      },
      { scope: 'devops' },
    )
    await settle()
    const cause = useNotificationsStore.getState().entries[0]!.trace?.[0]
    expect(cause).toMatchObject({
      summary: 'GET /rpc/acme/items failed',
      attributes: { cause: true, status: 503 },
    })
  })
})
