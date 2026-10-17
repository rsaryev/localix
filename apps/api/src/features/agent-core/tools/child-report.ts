import { truncateTail } from '@localixai/agent'
import { truncationMarker } from './tool-output'

/** Unbounded child reports once exhausted the parent's context. Keep the conclusion
 * (tail), with a pointer to the full child transcript, instead of copying its log. */
const CHILD_REPORT_MAX_LINES = 120
const CHILD_REPORT_MAX_BYTES = 12_000

export const NO_REPORT_NOTICE =
  'It produced no final text. Its transcript can be read with `history_search`.'

/**
 * Cap one child's report and, when capped, say exactly how to read the rest. Both ways a report
 * reaches its delegator use it: the wake message (`chat/runtime/delegation-report.ts`) and the
 * result of a `delegate` call that waited (`delegate-start.ts`).
 *
 * The bound is the whole defence against a tree bricking the conversation that owns it, and a
 * silent regression here is invisible until a session is already unrecoverable.
 */
export function childReport(text: string, childSessionId: string): string {
  const truncated = truncateTail(text, {
    maxLines: CHILD_REPORT_MAX_LINES,
    maxBytes: CHILD_REPORT_MAX_BYTES,
  })
  if (!truncated.truncated) return text
  return `${truncationMarker(truncated, {
    kept: 'last',
    advice: `Read the full transcript with history_search session_id:"${childSessionId}".`,
  })}\n${truncated.content}`
}

/** The report section a delegator reads: the bounded final text, or a notice that there is none. */
export function reportBody(text: string | null | undefined, childSessionId: string): string {
  const trimmed = text?.trim()
  return trimmed ? `Its final report:\n${childReport(trimmed, childSessionId)}` : NO_REPORT_NOTICE
}
