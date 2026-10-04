import { beforeEach, describe, expect, it } from 'bun:test'
import { API_BASE_URL, apiFetch } from '@/shared/api/internal'
import { activeEventOrigin, setActiveEventRoute } from './context'
import {
  apiFailureNeedsFallback,
  apiRequestTraceStep,
  startHttpEventTracing,
} from './httpInstrumentation'
import { resetUnreportedFailuresForTests } from './incidentFallback'
import { eventTraceSnapshot, resetEventTrace } from './trace'
import type { ObservedOperationContext } from './operationContext'

beforeEach(() => setActiveEventRoute('/project/PRJ-1/LOCALIX-22'))

describe('automatic HTTP event tracing', () => {
  it('captures mutations with the active session and safe transport metadata', () => {
    expect(
      apiRequestTraceStep({
        phase: 'failed',
        traceId: 'h3',
        operation: 'DELETE secrets',
        method: 'DELETE',
        ts: 1_000,
        durationMs: 12,
        attributes: { path: '/rpc/secrets', status: 503 },
        error: { status: 503 },
      }),
    ).toMatchObject({
      traceId: 'h3',
      phase: 'failed',
      kind: 'http.delete',
      origin: { kind: 'session', sessionId: 'LOCALIX-22', projectId: 'PRJ-1' },
      attributes: { path: '/rpc/secrets', status: 503 },
    })
  })

  it('suppresses successful reads, retains failed reads and ignores cancellation', () => {
    const base = {
      traceId: 'h4',
      operation: 'GET sessions',
      method: 'GET',
      ts: 1_000,
      attributes: { path: '/rpc/sessions' },
    } as const
    expect(apiRequestTraceStep({ ...base, phase: 'started' })).toBeNull()
    expect(apiRequestTraceStep({ ...base, phase: 'succeeded' })).toBeNull()
    expect(apiRequestTraceStep({ ...base, phase: 'failed' })).toMatchObject({
      kind: 'http.get',
      phase: 'failed',
    })
    expect(apiRequestTraceStep({ ...base, phase: 'cancelled' })).toBeNull()
  })

  it("never reports the journal's own delivery, which would feed the outage it describes", async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    resetEventTrace()
    const stop = startHttpEventTracing()
    try {
      for (const path of ['/rpc/notifications/ops', '/rpc/secrets']) {
        await apiFetch(`${API_BASE_URL}${path}`, { method: 'POST' }).catch(() => undefined)
      }
      const reported = eventTraceSnapshot(40, activeEventOrigin()).map(
        (step) => step.attributes?.path,
      )
      // The control request is traced — so the silence about the journal is the filter, not a
      // tracer that saw nothing.
      expect(reported).toContain('/rpc/secrets')
      expect(reported).not.toContain('/rpc/notifications')
    } finally {
      stop()
      resetUnreportedFailuresForTests()
      globalThis.fetch = realFetch
    }
  })

  it('surfaces an interactive read without turning background reads into noise', () => {
    const origin = { kind: 'session' as const, sessionId: 'LOCALIX-17', projectId: 'project-2' }
    const context: ObservedOperationContext = {
      origin,
      intent: { ts: 990, kind: 'click', control: 'button:Refresh', origin },
    }
    const failedRead = {
      phase: 'failed' as const,
      traceId: 'h5',
      operation: 'GET sessions',
      method: 'GET',
      ts: 1_000,
      attributes: { path: '/rpc/sessions' },
    }

    expect(apiFailureNeedsFallback(failedRead)).toBeFalse()
    expect(apiFailureNeedsFallback(failedRead, context)).toBeTrue()
    expect(apiRequestTraceStep(failedRead, context)).toMatchObject({
      origin,
      attributes: {
        initiatedBy: 'user',
        interactionKind: 'click',
        interactionControl: 'button:Refresh',
      },
    })
  })
})
