import { recordClientFact } from './clientFacts'
import { boundedKey } from './inboxMapping'
import { resolveNotificationCondition } from './store'
import { addEventTraceStep } from './trace'
import type { NotificationOrigin, NotificationSeverity, TraceAttributeValue } from './types'

interface IncidentNotice {
  severity: NotificationSeverity
  title: string
  message?: string
}

export interface JournalIncidentOptions {
  kind: string
  origin: NotificationOrigin
  unavailable: IncidentNotice
  /** What the recovery is called in the trace; the row itself settles rather than being joined. */
  recovered?: IncidentNotice
}

interface IncidentTransition {
  ts?: number
  sourceVisible?: boolean
  attributes?: Record<string, TraceAttributeValue>
  /**
   * Record the causal trace but publish no row of its own.
   *
   * For an owner that already reports this failure as a problem: the terminal's give-up published
   * both "Terminal connection unavailable" and its own problem report, two rows for one event, and
   * the problem report is the one that carries the recovery. The trace is still worth keeping — it
   * is what the surviving row's "Details" shows.
   */
  silent?: boolean
}

export interface JournalIncident {
  /** Starts a quiet candidate incident. Returns false when one is already active. */
  begin(ts?: number): boolean
  /** Publishes the active incident once; implicitly begins when needed. */
  fail(transition?: IncidentTransition): void
  /** Clears a quiet candidate, or settles the row of a reported incident. */
  recover(transition?: IncidentTransition): void
  /** The owner is gone (pane closed, app torn down): settle quietly, since nothing will recover it. */
  abandon(): void
}

let incidentSequence = 0

/** One condition per incident kind and origin: this terminal, this session, the app's socket. */
function incidentKey(kind: string, origin: NotificationOrigin): string {
  const where =
    origin.kind === 'application'
      ? 'application'
      : origin.kind === 'session'
        ? `${origin.projectId ?? ''}/${origin.sessionId}`
        : `${origin.projectId ?? ''}/${origin.sessionId}/${origin.resourceKind}/${origin.resourceId}`
  // Encoded parts and a closing separator: settling is a PREFIX match, and without them the outage of
  // session `s1` would also settle the one of `s12`.
  return `incident:${encodeURIComponent(kind)}:${encodeURIComponent(where)}:`
}

/**
 * Domain-neutral durable incident lifecycle for sockets, streams, bridges, and future long-lived
 * transports. Owners report state transitions; Event Center trace/persistence/recovery policy stays
 * centralized here.
 *
 * An outage is a STANDING CONDITION, not a pair of events. It used to publish "unavailable" and
 * later a separate "restored" row, which left the first one live beside the second — the journal
 * said the connection was down and up at once — and every flap added two more rows. Now the outage
 * is one row keyed by what is down; recovery settles it, and the next outage reopens it with a count.
 */
export function createJournalIncident(options: JournalIncidentOptions): JournalIncident {
  let active: { traceId: string; startedAt: number; reported: boolean } | null = null
  // The row's key IS its settle prefix: one row per outage subject, reopened when it recurs.
  const conditionPrefix = boundedKey(
    `application.condition:${incidentKey(options.kind, options.origin)}`,
  )

  const begin = (ts = Date.now()): boolean => {
    if (active) return false
    incidentSequence += 1
    active = {
      traceId: `${options.kind}-${incidentSequence.toString(36)}`,
      startedAt: ts,
      reported: false,
    }
    return true
  }

  return {
    begin,
    fail(transition = {}) {
      const ts = transition.ts ?? Date.now()
      if (!active) begin(ts)
      if (!active || active.reported) return
      active.reported = true
      addEventTraceStep({
        traceId: active.traceId,
        kind: options.kind,
        phase: 'started',
        summary: `${options.unavailable.title}: detection started`,
        origin: options.origin,
        ts: active.startedAt,
      })
      addEventTraceStep({
        traceId: active.traceId,
        kind: options.kind,
        phase: 'failed',
        summary: options.unavailable.title,
        origin: options.origin,
        ts,
        durationMs: ts - active.startedAt,
        attributes: transition.attributes,
      })
      if (transition.silent) return
      recordClientFact({
        key: conditionPrefix,
        condition: true,
        severity: options.unavailable.severity,
        title: options.unavailable.title,
        body: options.unavailable.message,
        origin: options.origin,
        sourceVisible: transition.sourceVisible ?? false,
        occurredAt: ts,
      })
    },
    recover(transition = {}) {
      const recovered = active
      active = null
      // Settled even with no incident in memory: a reload mid-outage restores the row from the
      // journal but not this state, and the first successful connect afterwards proves it over.
      resolveNotificationCondition(conditionPrefix)
      if (!recovered?.reported) return
      const ts = transition.ts ?? Date.now()
      addEventTraceStep({
        traceId: recovered.traceId,
        kind: options.kind,
        phase: 'succeeded',
        summary: options.recovered?.title ?? `${options.unavailable.title}: recovered`,
        origin: options.origin,
        ts,
        durationMs: ts - recovered.startedAt,
        attributes: transition.attributes,
      })
    },
    abandon() {
      const reported = active?.reported
      active = null
      if (reported) resolveNotificationCondition(conditionPrefix)
    },
  }
}
