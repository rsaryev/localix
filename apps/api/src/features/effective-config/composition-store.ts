import { createBoundedCache } from '../../lib/bounded-cache'
import { describeComposition, type CompositionReport } from './composition'

/**
 * The composition a session's most recent run actually used.
 *
 * A diagnostics endpoint could instead re-derive it on demand — but assembling a roster
 * GATHERS MCP servers, which means connecting to them, so a read-only question would start
 * making outbound connections as a side effect. And a re-derivation answers a subtly
 * different question ("what would a run assemble now") than the one being asked ("why did
 * that run not see my tool"). Recording what the run built is both free and more truthful.
 *
 * Process-local and last-write-wins per session: this is a diagnostic snapshot, not history.
 * Nothing to report before a session's first run is a real answer, and the endpoint says so
 * rather than inventing one.
 */

/** Sessions to retain snapshots for. Bounds a long-lived process; oldest is evicted first. */
const MAX_SESSIONS = 64

// Recency is the last RECORD: a diagnostics read `peek`s, so polling the endpoint cannot keep
// an idle session's snapshot alive over a running one.
const byLastRun = createBoundedCache<string, { report: CompositionReport; at: number }>({
  maxEntries: MAX_SESSIONS,
})

/**
 * Record the composition of a finished assembly. Never throws: a diagnostics snapshot must
 * not be able to fail the run it describes.
 */
export function recordComposition(
  sessionId: string,
  input: Parameters<typeof describeComposition>[0],
): void {
  try {
    byLastRun.set(sessionId, { report: describeComposition(input), at: Date.now() })
  } catch {
    /* a snapshot is never worth failing or slowing the run that produced it */
  }
}

/** The last recorded composition for a session, or undefined before its first run. */
export function getComposition(
  sessionId: string,
): { report: CompositionReport; at: number } | undefined {
  return byLastRun.peek(sessionId)
}
