import { beforeEach, describe, expect, it } from 'bun:test'
import { setActiveEventRoute } from './context'
import { rpcFailureNeedsFallback, rpcRequestTraceStep } from './rpcInstrumentation'
import type { ObservedOperationContext } from './operationContext'

beforeEach(() => setActiveEventRoute('/project/project-1/LOCALIX-18'))

describe('automatic RPC event tracing', () => {
  it('derives resource provenance without persisting request bodies', () => {
    const step = rpcRequestTraceStep({
      phase: 'failed',
      traceId: 'q42',
      operation: 'interact',
      ts: 1_000,
      durationMs: 24,
      attributes: { toolCallId: 'call-7', action: 'stop' },
      error: Object.assign(new Error('secret server detail'), {
        code: 'interaction_settled',
        status: 409,
      }),
    })

    expect(step).toMatchObject({
      traceId: 'q42',
      phase: 'failed',
      kind: 'rpc.interact',
      durationMs: 24,
      origin: {
        kind: 'resource',
        sessionId: 'LOCALIX-18',
        projectId: 'project-1',
        resourceKind: 'tool',
        resourceId: 'call-7',
      },
      attributes: {
        toolCallId: 'call-7',
        action: 'stop',
        errorType: 'Error',
        code: 'interaction_settled',
        status: 409,
      },
    })
    expect(JSON.stringify(step)).not.toContain('secret server detail')
  })

  it('suppresses passive success noise but retains passive failures', () => {
    const base = {
      traceId: 'q43',
      operation: 'lsp.hover',
      ts: 1_000,
      attributes: { sessionId: 'LOCALIX-18' },
    } as const

    expect(rpcRequestTraceStep({ ...base, phase: 'started' })).toBeNull()
    expect(rpcRequestTraceStep({ ...base, phase: 'succeeded', durationMs: 4 })).toBeNull()
    expect(rpcRequestTraceStep({ ...base, phase: 'failed', durationMs: 4 })).toMatchObject({
      kind: 'rpc.lsp.hover',
      phase: 'failed',
    })
  })

  it('treats cancellation as control flow, not an incident', () => {
    expect(
      rpcRequestTraceStep({
        phase: 'cancelled',
        traceId: 'q44',
        operation: 'send',
        ts: 1_000,
        attributes: { sessionId: 'LOCALIX-18' },
      }),
    ).toBeNull()
  })

  it('surfaces a user-triggered passive RPC but keeps background editor reads quiet', () => {
    const origin = { kind: 'session' as const, sessionId: 'LOCALIX-18', projectId: 'project-1' }
    const context: ObservedOperationContext = {
      origin,
      intent: { ts: 990, kind: 'keyboard', control: 'button:Inspect', origin },
    }
    const failure = {
      phase: 'failed' as const,
      traceId: 'q45',
      operation: 'lsp.hover',
      ts: 1_000,
      attributes: { sessionId: 'LOCALIX-18' },
    }

    expect(rpcFailureNeedsFallback(failure)).toBeFalse()
    expect(rpcFailureNeedsFallback(failure, context)).toBeTrue()
    expect(rpcRequestTraceStep(failure, context)).toMatchObject({
      attributes: {
        initiatedBy: 'user',
        interactionKind: 'keyboard',
        interactionControl: 'button:Inspect',
      },
    })
  })
})
