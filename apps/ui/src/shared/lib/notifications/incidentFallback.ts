import type { EventTraceStep, NotificationOrigin } from './types'

export interface UnreportedFailure {
  traceId: string
  /** The trace's technical summary ("PATCH mcp failed") — a diagnostic, never the headline. */
  summary: string
  /** The sentence a person reads if the row is written (`operationPhrases.ts`). */
  title: string
  origin: NotificationOrigin
  ts: number
}

type FailurePublisher = (failure: UnreportedFailure) => void

const REPORT_GRACE_MS = 900
/**
 * How close in time another failed request in the same scope must be to count as part of the
 * failure a row already reports. Matches the trace's own correlation window (`trace.ts`).
 */
const SIBLING_WINDOW_MS = 10_000
const pending = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; failure: UnreportedFailure }
>()
let publisher: FailurePublisher | null = null

/**
 * Gives the owning call site a short window to publish its better user-facing
 * message. If it stays silent, the transport boundary emits one generic event.
 */
export function scheduleUnreportedFailure(
  failure: UnreportedFailure,
  graceMs = REPORT_GRACE_MS,
): void {
  const previous = pending.get(failure.traceId)
  if (previous) clearTimeout(previous.timer)
  pending.set(failure.traceId, {
    failure,
    timer: setTimeout(() => {
      pending.delete(failure.traceId)
      publisher?.(failure)
    }, graceMs),
  })
}

function sameScope(left: NotificationOrigin, right: NotificationOrigin): boolean {
  if (left.kind === 'application' || right.kind === 'application') return left.kind === right.kind
  return left.sessionId === right.sessionId
}

function acknowledge(traceId: string): void {
  const entry = pending.get(traceId)
  if (!entry) return
  clearTimeout(entry.timer)
  pending.delete(traceId)
}

/**
 * Cancel fallbacks whose failure a durable event already reports.
 *
 * A row's trace carries ONE failed request — the newest in its scope. Acknowledging only that one
 * left the others to publish their generic "<operation> failed" rows beside it: a batch delete that
 * reported "Could not delete 3 entries" also produced two anonymous rows, and an unhandled rejection
 * (which records a failure step of its own) never acknowledged the request that caused it. So a
 * reported failure also covers the other failed requests of the same scope around it.
 */
export function acknowledgeReportedTrace(trace: readonly EventTraceStep[]): void {
  const failures = trace.filter((step) => step.phase === 'failed')
  if (failures.length === 0) return
  for (const step of failures) if (step.traceId) acknowledge(step.traceId)
  for (const [traceId, { failure }] of pending) {
    const sibling = failures.some(
      (step) =>
        sameScope(step.origin, failure.origin) &&
        Math.abs(step.ts - failure.ts) <= SIBLING_WINDOW_MS,
    )
    if (sibling) acknowledge(traceId)
  }
}

export function startUnreportedFailurePublisher(next: FailurePublisher): () => void {
  publisher = next
  return () => {
    if (publisher === next) publisher = null
  }
}

export function resetUnreportedFailuresForTests(): void {
  for (const { timer } of pending.values()) clearTimeout(timer)
  pending.clear()
  publisher = null
}
