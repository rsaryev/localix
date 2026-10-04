import { beforeEach, describe, expect, it } from 'bun:test'
import {
  addEventTraceStep,
  correlatedFailureOrigin,
  eventTraceSnapshot,
  resetEventTrace,
} from './trace'

beforeEach(resetEventTrace)

const toolOrigin = {
  kind: 'resource' as const,
  sessionId: 'LOCALIX-18',
  projectId: null,
  resourceKind: 'tool',
  resourceId: 'call-1',
}

describe('event trace', () => {
  it('captures arbitrary typed steps and immutable attributes', () => {
    addEventTraceStep({
      kind: 'tool.action',
      summary: 'Stop requested',
      origin: toolOrigin,
      attributes: { action: 'stop', attempt: 1, accepted: false },
    })
    const snapshot = eventTraceSnapshot(8, toolOrigin)
    expect(snapshot[0]).toMatchObject({
      kind: 'tool.action',
      summary: 'Stop requested',
      attributes: { action: 'stop', attempt: 1, accepted: false },
    })
    snapshot[0]!.attributes!.action = 'changed'
    expect(eventTraceSnapshot(8, toolOrigin)[0]!.attributes!.action).toBe('stop')
  })

  it('deduplicates repeated steps and excludes unrelated resources and sessions', () => {
    addEventTraceStep({ kind: 'tool.action', summary: 'Stop requested', origin: toolOrigin })
    addEventTraceStep({ kind: 'tool.action', summary: 'Stop requested', origin: toolOrigin })
    addEventTraceStep({
      kind: 'tool.action',
      summary: 'Other tool',
      origin: { ...toolOrigin, resourceId: 'call-2' },
    })
    addEventTraceStep({
      kind: 'tool.action',
      summary: 'Other session',
      origin: { ...toolOrigin, sessionId: 'LOCALIX-16' },
    })

    expect(eventTraceSnapshot(8, toolOrigin).map((step) => step.summary)).toEqual([
      'Stop requested',
    ])
  })

  it('keeps only the failed operation lane and exposes its precise origin', () => {
    const now = Date.now()
    addEventTraceStep({
      traceId: 'q1',
      phase: 'started',
      kind: 'rpc.send',
      summary: 'send started',
      origin: { kind: 'session', sessionId: 'LOCALIX-18', projectId: null },
      ts: now - 20,
    })
    addEventTraceStep({
      traceId: 'q2',
      phase: 'succeeded',
      kind: 'rpc.preview',
      summary: 'preview completed',
      origin: { kind: 'session', sessionId: 'LOCALIX-18', projectId: null },
      ts: now - 10,
    })
    addEventTraceStep({
      traceId: 'q1',
      phase: 'failed',
      kind: 'rpc.send',
      summary: 'send failed',
      origin: toolOrigin,
      ts: now,
    })

    expect(eventTraceSnapshot(8, toolOrigin).map((step) => step.traceId)).toEqual(['q1', 'q1'])
    expect(
      correlatedFailureOrigin({ kind: 'session', sessionId: 'LOCALIX-18', projectId: null }, now),
    ).toEqual(toolOrigin)
  })
})
