import { failureSentence } from '@/shared/api/failure'
import { activeEventOrigin } from './context'
import { acknowledgeReportedTrace } from './incidentFallback'
import { correlatedFailureOrigin, eventTraceSnapshot } from './trace'

/**
 * A failure the person is ALREADY reading at the control, so the transport stays quiet about it.
 *
 * Every failed mutation schedules a generic journal row ("Could not save the MCP settings") that
 * fires after a short grace unless something reports the failure better (`incidentFallback.ts`).
 * Only a journal write counted as "better": a form that put "This server could not be saved." on
 * its own error line, right under the Save button, still got the generic row 900 ms later — the
 * same failure twice, once in context and once as an unread badge pointing back at it.
 *
 * Showing the failure inline IS reporting it. This acknowledges the failed request (and its
 * same-scope siblings, by the rule `acknowledgeReportedTrace` already applies to journal rows) the
 * same way a journal write would, without writing one. A cancellation reported nothing and is
 * passed over.
 */
export function acknowledgeInline(error?: unknown): void {
  if (error instanceof Error && error.name === 'AbortError') return
  const origin = correlatedFailureOrigin(activeEventOrigin())
  acknowledgeReportedTrace(eventTraceSnapshot(8, origin))
}

/**
 * The sentence an inline error line shows, with the failure acknowledged on the way: the one call
 * an inline `setError(...)` site makes, so showing it and silencing the duplicate cannot drift apart.
 */
export function inlineFailure(error: unknown, fallback: string): string {
  acknowledgeInline(error)
  return failureSentence(error, fallback)
}
