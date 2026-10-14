import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { RealtimeDiagnosticEvent } from '@/shared/api/eventSocket'
import { startRealtimeEventTracing, type RealtimeEventSource } from './realtimeInstrumentation'
import { resetNotificationsForTests, useNotificationsStore } from './store'
import { resetEventTrace } from './trace'
import { setActiveEventRoute } from './context'

class FakeRealtimeSource implements RealtimeEventSource {
  diagnostics = new Set<(event: RealtimeDiagnosticEvent) => void>()
  disconnects = new Set<() => void>()
  connections = new Set<() => void>()

  onDiagnosticEvent(handler: (event: RealtimeDiagnosticEvent) => void): () => void {
    this.diagnostics.add(handler)
    return () => this.diagnostics.delete(handler)
  }

  onDisconnect(handler: () => void): () => void {
    this.disconnects.add(handler)
    return () => this.disconnects.delete(handler)
  }

  onConnected(handler: () => void): () => void {
    this.connections.add(handler)
    return () => this.connections.delete(handler)
  }

  diagnostic(event: RealtimeDiagnosticEvent): void {
    for (const handler of this.diagnostics) handler(event)
  }

  disconnect(): void {
    for (const handler of this.disconnects) handler()
  }

  connect(): void {
    for (const handler of this.connections) handler()
  }
}

const flush = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  resetNotificationsForTests()
  resetEventTrace()
  setActiveEventRoute('/project/project-1/LOCALIX-18')
})

afterEach(() => {
  resetNotificationsForTests()
  resetEventTrace()
})

describe('automatic realtime event tracing', () => {
  it('turns a safe transport diagnostic into a session-scoped journal event', async () => {
    const source = new FakeRealtimeSource()
    const stop = startRealtimeEventTracing({ source })
    source.diagnostic({
      id: 'realtime-1',
      ts: Date.now(),
      kind: 'handler.session',
      severity: 'error',
      summary: 'Session update handler failed',
      message: 'The update was not applied; realtime state will resynchronize.',
      sessionId: 'LOCALIX-18',
      attributes: { eventType: 'message.delta' },
      error: new TypeError('private implementation detail'),
    })
    await flush()

    const entry = useNotificationsStore.getState().entries[0]
    expect(entry).toMatchObject({
      title: 'Session update handler failed',
      origin: {
        kind: 'session',
        sessionId: 'LOCALIX-18',
        projectId: 'project-1',
        label: 'Realtime',
      },
    })
    expect(entry?.trace?.some((step) => step.attributes?.errorType === 'TypeError')).toBeTrue()
    expect(JSON.stringify(entry)).not.toContain('private implementation detail')
    stop()
  })

  it('keeps a short reconnect quiet but journals a sustained outage and its recovery', async () => {
    const source = new FakeRealtimeSource()
    const stop = startRealtimeEventTracing({ source, outageGraceMs: 5 })

    source.disconnect()
    source.connect()
    await flush(8)
    expect(useNotificationsStore.getState().entries).toEqual([])

    source.disconnect()
    await flush(8)
    expect(useNotificationsStore.getState().entries[0]).toMatchObject({
      severity: 'warning',
      title: 'Realtime connection unavailable',
    })

    source.connect()
    await flush()
    // Recovery settles the outage row instead of adding a "restored" row beside a live "unavailable".
    const entries = useNotificationsStore.getState().entries
    expect(entries.map((entry) => entry.title)).toEqual(['Realtime connection unavailable'])
    expect(entries[0]?.resolvedAt).toBeGreaterThan(0)
    expect(entries[0]?.trace?.map((step) => step.phase)).toEqual(['started', 'failed', 'event'])
    stop()
  })
})
