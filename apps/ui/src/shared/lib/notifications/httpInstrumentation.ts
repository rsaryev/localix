import { onApiRequestEvent, type ApiRequestEvent } from '@/shared/api/internal'
import { activeEventOrigin } from './context'
import { addEventTraceStep } from './trace'
import type { EventTraceStep, TraceAttributeValue } from './types'
import { scheduleUnreportedFailure } from './incidentFallback'
import { httpOperationTitle } from './operationPhrases'
import {
  isUserInitiatedOperation,
  observeOperationContext,
  operationContextAttributes,
  type ObservedOperationContext,
} from './operationContext'

function errorAttributes(error: unknown): Record<string, TraceAttributeValue> {
  if (!error || typeof error !== 'object') return {}
  const value = error as Record<string, unknown>
  const attributes: Record<string, TraceAttributeValue> = {}
  if (error instanceof Error) attributes.errorType = error.name.slice(0, 80)
  if (typeof value.status === 'number') attributes.status = value.status
  if (typeof value.code === 'string') attributes.code = value.code.slice(0, 120)
  return attributes
}

export function apiRequestTraceStep(
  event: ApiRequestEvent,
  context?: ObservedOperationContext,
): Omit<EventTraceStep, 'id'> | null {
  if (event.phase === 'cancelled') return null
  if ((event.method === 'GET' || event.method === 'HEAD') && event.phase !== 'failed') return null
  return {
    traceId: event.traceId,
    phase: event.phase,
    kind: `http.${event.method.toLocaleLowerCase()}`,
    summary: `${event.operation} ${event.phase === 'succeeded' ? 'completed' : event.phase}`,
    origin: context?.origin ?? activeEventOrigin(),
    ts: event.ts,
    durationMs: event.durationMs,
    attributes: {
      ...event.attributes,
      ...operationContextAttributes(context),
      ...(event.phase === 'failed' ? errorAttributes(event.error) : {}),
    },
  }
}

/**
 * Background convergence the app retries or settles on its own, never a person's action. The
 * UI-location catalog is republished on every registry change and reconnect; a failed publish
 * raised "Could not save the layout" once per window per attempt — about nothing the person did
 * or can fix. Its trace step is still recorded as a diagnostic.
 */
const BACKGROUND_SYNC_OPERATIONS = new Set(['PUT ui-locations'])

export function apiFailureNeedsFallback(
  event: ApiRequestEvent,
  context?: ObservedOperationContext,
): boolean {
  if (BACKGROUND_SYNC_OPERATIONS.has(event.operation) && !isUserInitiatedOperation(context)) {
    return false
  }
  return (
    event.phase === 'failed' &&
    ((event.method !== 'GET' && event.method !== 'HEAD') || isUserInitiatedOperation(context))
  )
}

/**
 * The journal's own delivery is not an operation to report. While the API is unreachable every
 * notification POST fails; reported, each failure would raise a fact, whose POST would fail and
 * raise another — a loop that fills the outbox. Those ops wait in the outbox (`outbox.ts`) instead.
 */
const JOURNAL_PATH = '/rpc/notifications'

function recordApiRequest(event: ApiRequestEvent): void {
  if (event.attributes.path === JOURNAL_PATH) return
  const context = observeOperationContext({
    traceId: event.traceId,
    phase: event.phase,
    ts: event.ts,
    origin: activeEventOrigin(),
  })
  const step = apiRequestTraceStep(event, context)
  if (!step) return
  addEventTraceStep(step)
  if (apiFailureNeedsFallback(event, context)) {
    scheduleUnreportedFailure({
      traceId: event.traceId,
      summary: step.summary,
      title: httpOperationTitle(event.operation),
      origin: step.origin,
      ts: event.ts,
    })
  }
}

export function startHttpEventTracing(): () => void {
  return onApiRequestEvent(recordApiRequest)
}
