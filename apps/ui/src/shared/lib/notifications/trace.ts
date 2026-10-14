import { sameOrigin } from './origin'
import type { EventTraceStep, NotificationOrigin } from './types'

const MAX_TRACE_STEPS = 40
const TRACE_CONTEXT_MS = 5 * 60_000
const FAILURE_CORRELATION_MS = 10_000
const FAILURE_ORIGIN_MS = 1_500
let sequence = 0
let steps: EventTraceStep[] = []

export function addEventTraceStep(
  input: Omit<EventTraceStep, 'id' | 'ts'> & Partial<Pick<EventTraceStep, 'ts'>>,
): void {
  const previous = steps.at(-1)
  if (
    previous?.kind === input.kind &&
    previous.summary === input.summary &&
    previous.traceId === input.traceId &&
    previous.phase === input.phase &&
    sameOrigin(previous.origin, input.origin)
  ) {
    return
  }
  sequence += 1
  steps = [
    ...steps,
    { ...input, id: `trace-${sequence.toString(36)}`, ts: input.ts ?? Date.now() },
  ].slice(-MAX_TRACE_STEPS)
}

/**
 * The steps of exactly these traces, each marked as a cause — or an empty list when none of them is
 * in the buffer any more.
 *
 * The defect this exists for: without a named cause, the snapshot below takes "the newest failure
 * in this session within ten seconds", and a Kubernetes poll failing every second won that race
 * against the Docker request a Docker problem was actually about. A producer that KNOWS its request
 * names it, and then nothing is guessed — an absent step is better than a confidently wrong one.
 */
export function causalTraceSnapshot(traceIds: readonly string[], limit = 8): EventTraceStep[] {
  const wanted = new Set(traceIds)
  const matching = steps
    .filter((step) => step.traceId && wanted.has(step.traceId))
    .map((step) =>
      step.phase === 'failed' ? { ...step, attributes: { ...step.attributes, cause: true } } : step,
    )
  return compactEventTrace(matching, limit)
}

/** Where a named trace happened, when its steps are still in the buffer. */
export function traceOrigin(traceIds: readonly string[]): NotificationOrigin | undefined {
  const wanted = new Set(traceIds)
  return steps.toReversed().find((step) => step.traceId && wanted.has(step.traceId))?.origin
}

/** Immutable, source-scoped snapshot of the causal steps preceding an event. */
export function eventTraceSnapshot(
  limit = 8,
  origin: NotificationOrigin = { kind: 'application' },
): EventTraceStep[] {
  const relevant =
    origin.kind === 'application'
      ? steps.filter((step) => step.origin.kind === 'application')
      : steps.filter((step) => {
          if (
            step.origin.kind === 'application' ||
            step.origin.sessionId !== origin.sessionId ||
            step.origin.projectId !== origin.projectId
          ) {
            return false
          }
          if (origin.kind !== 'resource') return true
          return step.origin.kind === 'session' || sameOrigin(step.origin, origin)
        })
  const now = Date.now()
  const recent = relevant.filter((step) => now - step.ts <= TRACE_CONTEXT_MS)
  const failure = recent
    .toReversed()
    .find(
      (step) => step.phase === 'failed' && step.traceId && now - step.ts <= FAILURE_CORRELATION_MS,
    )
  const correlated = failure?.traceId
    ? recent.filter((step) => step.traceId === failure.traceId)
    : recent
  return compactEventTrace(correlated, limit)
}

export function compactEventTrace(items: readonly EventTraceStep[], limit = 8): EventTraceStep[] {
  const unique = items.filter(
    (step, index) =>
      items.findLastIndex(
        (candidate) =>
          candidate.kind === step.kind &&
          candidate.summary === step.summary &&
          sameOrigin(candidate.origin, step.origin),
      ) === index,
  )
  return unique.slice(-limit).map((step) => ({
    ...step,
    attributes: step.attributes ? { ...step.attributes } : undefined,
  }))
}

/**
 * Application publishers often only know the user-facing error message. A failed
 * request observed immediately before it is the stronger source of provenance.
 */
export function correlatedFailureOrigin(
  fallback: NotificationOrigin,
  now = Date.now(),
): NotificationOrigin {
  const failure = steps.toReversed().find((step) => {
    if (step.phase !== 'failed' || now - step.ts > FAILURE_ORIGIN_MS) return false
    if (fallback.kind === 'application') return true
    return (
      step.origin.kind !== 'application' &&
      step.origin.sessionId === fallback.sessionId &&
      step.origin.projectId === fallback.projectId
    )
  })
  return failure?.origin ?? fallback
}

export function resetEventTrace(): void {
  steps = []
  sequence = 0
}
