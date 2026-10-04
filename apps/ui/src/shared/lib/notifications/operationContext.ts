import { createBoundedCache } from '@localixai/kit/lib'
import { isBackgroundWork } from '@localixai/plugin-sdk/ui/visibility'
import { recentUserIntent, type UserIntentContext } from './userIntent'
import type { NotificationOrigin, TraceAttributeValue } from './types'

export type ObservedOperationPhase = 'started' | 'succeeded' | 'failed' | 'cancelled'

export interface ObservedOperationContext {
  origin: NotificationOrigin
  intent: UserIntentContext | null
}

const contexts = createBoundedCache<string, ObservedOperationContext>({ maxEntries: 256 })

function intentMatchesOrigin(
  intent: UserIntentContext | null,
  origin: NotificationOrigin,
): boolean {
  if (!intent) return false
  if (intent.origin.kind === 'application' || origin.kind === 'application') {
    return intent.origin.kind === origin.kind
  }
  return (
    intent.origin.sessionId === origin.sessionId &&
    (intent.origin.projectId === null ||
      origin.projectId === null ||
      intent.origin.projectId === origin.projectId)
  )
}

function snapshotContext(origin: NotificationOrigin, ts: number): ObservedOperationContext {
  // A poll's tick inside the two-second window after a click is still the timer's work.
  const intent = isBackgroundWork() ? null : recentUserIntent(ts)
  return {
    origin: { ...origin },
    intent: intentMatchesOrigin(intent, origin) ? intent : null,
  }
}

/**
 * Pins provenance at operation start, then releases it at the terminal phase.
 * The bounded map tolerates abandoned requests without becoming an unbounded log.
 */
export function observeOperationContext(input: {
  traceId: string
  phase: ObservedOperationPhase
  ts: number
  origin: NotificationOrigin
}): ObservedOperationContext {
  if (input.phase === 'started') {
    const context = snapshotContext(input.origin, input.ts)
    contexts.set(input.traceId, context)
    return context
  }
  const context = contexts.peek(input.traceId) ?? snapshotContext(input.origin, input.ts)
  contexts.delete(input.traceId)
  return context
}

export function operationContextAttributes(
  context: ObservedOperationContext | undefined,
): Record<string, TraceAttributeValue> {
  if (!context?.intent) return {}
  return {
    initiatedBy: 'user',
    interactionKind: context.intent.kind,
    interactionControl: context.intent.control,
  }
}

export function isUserInitiatedOperation(context: ObservedOperationContext | undefined): boolean {
  return context?.intent != null
}

export function resetOperationContextsForTests(): void {
  contexts.clear()
}
