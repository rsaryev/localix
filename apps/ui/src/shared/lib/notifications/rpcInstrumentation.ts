import { eventSocket, type RpcRequestEvent, type RpcRequestPhase } from '@/shared/api/eventSocket'
import { activeEventOrigin } from './context'
import { addEventTraceStep } from './trace'
import type { EventTraceStep, NotificationOrigin, TraceAttributeValue } from './types'
import { scheduleUnreportedFailure } from './incidentFallback'
import { socketOperationTitle } from './operationPhrases'
import {
  isUserInitiatedOperation,
  observeOperationContext,
  operationContextAttributes,
  type ObservedOperationContext,
} from './operationContext'

/** High-frequency/editor reads add noise but their failures remain diagnostically useful. */
const PASSIVE_OPERATION_PREFIXES = ['inline.', 'lsp.'] as const
const PASSIVE_OPERATIONS = new Set(['predictNextEdit'])

const RESOURCE_ATTRIBUTES = [
  ['toolCallId', 'tool'],
  ['terminalId', 'terminal'],
  ['requestId', 'interaction'],
  ['commandId', 'command'],
] as const

function isPassiveOperation(operation: string): boolean {
  return (
    PASSIVE_OPERATIONS.has(operation) ||
    PASSIVE_OPERATION_PREFIXES.some((prefix) => operation.startsWith(prefix))
  )
}

function requestOrigin(event: RpcRequestEvent): NotificationOrigin {
  const active = activeEventOrigin()
  const sessionId = event.attributes.sessionId
  const base: NotificationOrigin =
    typeof sessionId === 'string'
      ? {
          kind: 'session',
          sessionId,
          projectId:
            active.kind !== 'application' && active.sessionId === sessionId
              ? active.projectId
              : null,
        }
      : active

  const resource = RESOURCE_ATTRIBUTES.find(
    ([attribute]) => typeof event.attributes[attribute] === 'string',
  )
  if (!resource || base.kind === 'application') return base
  const [attribute, resourceKind] = resource
  return {
    kind: 'resource',
    sessionId: base.sessionId,
    projectId: base.projectId,
    resourceKind,
    resourceId: String(event.attributes[attribute]),
  }
}

function errorAttributes(error: unknown): Record<string, TraceAttributeValue> {
  if (!error || typeof error !== 'object') return {}
  const value = error as Record<string, unknown>
  const attributes: Record<string, TraceAttributeValue> = {}
  if (error instanceof Error) attributes.errorType = error.name.slice(0, 80)
  for (const key of ['code', 'status'] as const) {
    const item = value[key]
    if (typeof item === 'string' || typeof item === 'number') attributes[key] = item
  }
  return attributes
}

function phaseLabel(phase: RpcRequestPhase): string {
  return phase === 'started'
    ? 'started'
    : phase === 'succeeded'
      ? 'completed'
      : phase === 'cancelled'
        ? 'cancelled'
        : 'failed'
}

export function rpcRequestTraceStep(
  event: RpcRequestEvent,
  context?: ObservedOperationContext,
): Omit<EventTraceStep, 'id'> | null {
  if (event.phase === 'cancelled') return null
  if (event.phase !== 'failed' && isPassiveOperation(event.operation)) return null
  return {
    traceId: event.traceId,
    phase: event.phase,
    kind: `rpc.${event.operation}`,
    summary: `${event.operation} ${phaseLabel(event.phase)}`,
    origin: context?.origin ?? requestOrigin(event),
    ts: event.ts,
    durationMs: event.durationMs,
    attributes: {
      ...event.attributes,
      ...operationContextAttributes(context),
      ...(event.phase === 'failed' ? errorAttributes(event.error) : {}),
    },
  }
}

export function rpcFailureNeedsFallback(
  event: RpcRequestEvent,
  context?: ObservedOperationContext,
): boolean {
  return (
    event.phase === 'failed' &&
    (!isPassiveOperation(event.operation) || isUserInitiatedOperation(context))
  )
}

function recordRequestEvent(event: RpcRequestEvent): void {
  const context = observeOperationContext({
    traceId: event.traceId,
    phase: event.phase,
    ts: event.ts,
    origin: requestOrigin(event),
  })
  const step = rpcRequestTraceStep(event, context)
  if (!step) return
  addEventTraceStep(step)
  if (rpcFailureNeedsFallback(event, context)) {
    scheduleUnreportedFailure({
      traceId: event.traceId,
      summary: step.summary,
      title: socketOperationTitle(event.operation),
      origin: step.origin,
      ts: event.ts,
    })
  }
}

/** Install once at the application boundary; returns a StrictMode-safe cleanup. */
export function startRpcEventTracing(): () => void {
  return eventSocket.onRequestEvent(recordRequestEvent)
}
