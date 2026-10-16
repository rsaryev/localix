import { eventSocket, type RealtimeDiagnosticEvent } from '@/shared/api/eventSocket'
import { recordClientFact } from './clientFacts'
import { activeEventOrigin } from './context'
import { addEventTraceStep } from './trace'
import type { NotificationOrigin, TraceAttributeValue } from './types'
import { createJournalIncident } from './journalIncident'

export const REALTIME_OUTAGE_GRACE_MS = 10_000

export interface RealtimeEventSource {
  onDiagnosticEvent(handler: (event: RealtimeDiagnosticEvent) => void): () => void
  onDisconnect(handler: () => void): () => void
  onConnected(handler: () => void): () => void
}

function diagnosticOrigin(event: RealtimeDiagnosticEvent): NotificationOrigin {
  if (!event.sessionId) return { kind: 'application', label: 'Realtime' }
  const active = activeEventOrigin()
  return {
    kind: 'session',
    sessionId: event.sessionId,
    projectId:
      active.kind !== 'application' && active.sessionId === event.sessionId
        ? active.projectId
        : null,
    label: 'Realtime',
  }
}

function diagnosticAttributes(event: RealtimeDiagnosticEvent): Record<string, TraceAttributeValue> {
  const attributes: Record<string, TraceAttributeValue> = { ...event.attributes }
  if (event.error instanceof Error) attributes.errorType = event.error.name.slice(0, 80)
  if (event.error && typeof event.error === 'object') {
    const value = event.error as Record<string, unknown>
    if (typeof value.code === 'string' || typeof value.code === 'number') {
      attributes.code = value.code
    }
  }
  return attributes
}

function publishDiagnostic(event: RealtimeDiagnosticEvent): void {
  const origin = diagnosticOrigin(event)
  addEventTraceStep({
    traceId: event.id,
    kind: `realtime.${event.kind}`,
    phase: event.severity === 'error' ? 'failed' : 'event',
    summary: event.summary,
    origin,
    ts: event.ts,
    attributes: diagnosticAttributes(event),
  })
  recordClientFact({
    severity: event.severity,
    title: event.summary,
    body: event.message,
    origin,
    occurredAt: event.ts,
  })
}

/**
 * One application-level observer for transport integrity and liveness. Ordinary
 * reconnects stay invisible; only an outage that exceeds the grace period enters
 * history, followed by a recovery fact when live updates resume.
 */
export function startRealtimeEventTracing(options?: {
  source?: RealtimeEventSource
  outageGraceMs?: number
}): () => void {
  const source = options?.source ?? eventSocket
  const outageGraceMs = options?.outageGraceMs ?? REALTIME_OUTAGE_GRACE_MS
  let outageTimer: ReturnType<typeof setTimeout> | null = null
  const outage = createJournalIncident({
    kind: 'realtime.connection',
    origin: { kind: 'application', label: 'Realtime' },
    unavailable: {
      severity: 'warning',
      title: 'Realtime connection unavailable',
      message: 'Live updates and interactive actions may be delayed while reconnecting.',
    },
    recovered: {
      severity: 'success',
      title: 'Realtime connection restored',
      message: 'Live updates and interactive actions are active again.',
    },
  })

  const offDiagnostic = source.onDiagnosticEvent(publishDiagnostic)
  const offDisconnect = source.onDisconnect(() => {
    if (!outage.begin()) return
    outageTimer = setTimeout(
      () => {
        outageTimer = null
        outage.fail()
      },
      Math.max(0, outageGraceMs),
    )
  })
  const offConnected = source.onConnected(() => {
    if (outageTimer) {
      clearTimeout(outageTimer)
      outageTimer = null
    }
    outage.recover()
  })

  return () => {
    if (outageTimer) clearTimeout(outageTimer)
    outageTimer = null
    outage.abandon()
    offDiagnostic()
    offDisconnect()
    offConnected()
  }
}
