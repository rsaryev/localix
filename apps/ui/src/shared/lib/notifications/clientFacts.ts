import type { NotificationTopic } from '@localixai/notifications'

import type { DesktopNotifyKind } from '@/shared/lib/desktopNotify'
import { activeEventOrigin } from './context'
import { acknowledgeReportedTrace } from './incidentFallback'
import { useNotificationsStore } from './store'
import type { ProblemRequest } from '@localixai/plugin-sdk/ui/problems'
import {
  causalTraceSnapshot,
  compactEventTrace,
  correlatedFailureOrigin,
  eventTraceSnapshot,
  traceOrigin,
} from './trace'
import type {
  NotificationAction,
  NotificationCategory,
  NotificationOrigin,
  NotificationSeverity,
  TraceAttributeValue,
} from './types'

/**
 * THE ONE WAY A FACT ONLY THIS CLIENT KNOWS ENTERS THE JOURNAL — a failed copy, a crashed view, a
 * board file that will not validate, the socket being down. The server records what it knows
 * itself (runs, requests, plugins); this is the same write path for the rest, so both kinds land
 * in one inbox and are read, cleared and synced alike.
 *
 * What it adds on the way is what only this window can: the causal trace of the moment (the
 * failed request just before a crash), the provenance of the screen it happened on, and the
 * callbacks and delivery wishes that cannot be stored (`overlay.ts`).
 */
export interface ClientFact {
  severity: NotificationSeverity
  title: string
  body?: string
  topic?: NotificationTopic
  category?: NotificationCategory
  /**
   * The fact's identity. Omitted for an anonymous event, which gets a per-invocation key and
   * coalesces with an identical repeat; given for a condition or anything a later call settles.
   */
  key?: string
  /** A standing condition: settled when fixed, reopened with a count when it comes back. */
  condition?: boolean
  /** Where it happened; defaults to the failed operation just before, else the visible screen. */
  origin?: NotificationOrigin
  /** Who reported it (a plugin's name), as a label on whichever origin the row gets. */
  originLabel?: string
  actions?: NotificationAction[]
  /** The person is looking at the surface that reports it: recorded without an unread badge. */
  sourceVisible?: boolean
  occurredAt?: number
  /** The OS banner this fact is worth, if any. Omitted: it stays inside the app. */
  nativeKind?: DesktopNotifyKind
  /**
   * The requests that caused it, when the producer knows them. Their steps ARE the trace; without
   * them the trace is guessed from the newest failure nearby.
   */
  causes?: readonly ProblemRequest[]
}

/**
 * The trace steps a fact's named causes contribute: their own steps when still buffered, otherwise
 * one step rebuilt from what the producer knows about the request (method, path, status, the
 * server's request id) — so the row still says WHICH call failed, and can be found in the API log.
 */
function causeSteps(causes: readonly ProblemRequest[], origin: NotificationOrigin) {
  const ids = causes.flatMap((cause) => (cause.traceId ? [cause.traceId] : []))
  const buffered = ids.length ? causalTraceSnapshot(ids, 7) : []
  if (buffered.length) return buffered
  return causes.map((cause, index) => {
    const method = cause.method ?? 'GET'
    return {
      id: `cause:${cause.traceId ?? index}:${cause.path ?? ''}`,
      ts: Date.now(),
      ...(cause.traceId ? { traceId: cause.traceId } : {}),
      phase: 'failed' as const,
      kind: `http.${method.toLowerCase()}`,
      summary: `${method} ${cause.path ?? 'request'} failed`,
      origin,
      attributes: requestAttributes(cause),
    }
  })
}

function requestAttributes(cause: ProblemRequest): Record<string, TraceAttributeValue> {
  return {
    cause: true,
    ...(cause.path ? { path: cause.path } : {}),
    ...(cause.status !== undefined ? { status: cause.status } : {}),
    ...(cause.requestId ? { requestId: cause.requestId } : {}),
  }
}

export function recordClientFact(fact: ClientFact): string {
  const topic = fact.topic ?? 'application.notification'
  const occurredAt = fact.occurredAt ?? Date.now()
  const causes = fact.causes ?? []
  const causeIds = causes.flatMap((cause) => (cause.traceId ? [cause.traceId] : []))
  // A named cause decides the origin too; the time-window guess is only for facts that name none.
  const derived =
    fact.origin ??
    (causeIds.length ? traceOrigin(causeIds) : undefined) ??
    correlatedFailureOrigin(activeEventOrigin())
  const label = fact.originLabel ?? derived.label
  const origin: NotificationOrigin = label ? { ...derived, label } : derived
  const key = fact.key
  const trace = compactEventTrace(
    [
      ...(causes.length ? causeSteps(causes, origin) : eventTraceSnapshot(7, origin)),
      {
        id: `event:${key ?? topic}:${occurredAt.toString(36)}`,
        traceId: key,
        phase: 'event',
        kind: topic,
        summary: fact.title,
        ts: occurredAt,
        origin,
        attributes: { source: 'application', topic },
      },
    ],
    8,
  )
  const id = useNotificationsStore.getState().push(
    {
      ...(key ? { id: key } : {}),
      topic,
      category: fact.category ?? 'system',
      severity: fact.severity,
      title: fact.title,
      message: fact.body,
      origin,
      trace,
      actions: fact.actions?.length ? fact.actions : undefined,
      condition: fact.condition,
      read: fact.sourceVisible ?? false,
      ts: occurredAt,
    },
    { coalesce: !key, hint: { nativeKind: fact.nativeKind ?? null } },
  )
  // The row now reports this trace's failure, so the transport's generic fallback stays silent.
  acknowledgeReportedTrace(trace)
  return id
}
