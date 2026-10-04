/**
 * Mid-run interjection — pure core of draining queued user messages INTO an
 * active run.
 *
 * Pattern mined from xAI grok-build (interjection-core): user messages sent
 * while a run is in flight are drained at a SAFE POINT before the next
 * sampling step — after the previous turn's tool results are appended, before
 * the next model request — as standalone synthetic user messages, FIFO, never
 * merged. Each one is framed so the model knows it arrived mid-work, and an
 * oversized one is truncated on a code-point boundary with an explicit notice.
 *
 * This module is PURE (framing + truncation + the enabled flag). The wiring — WHEN to drain (the loop's turn
 * boundary), the queue consumption, persistence, and the safety gates that
 * need runtime state (pending HITL, session kind) — lives in
 * chat/runtime/run/steering.ts.
 */
import { envFlag } from '../../lib/env'

/** Hard cap on one interjection's wire size (chars). grok-build caps at 25k. */
export const MAX_INTERJECTION_CHARS = 25_000

/**
 * Kill switch: `LOCALIX_MID_RUN_INTERJECT=0` disables mid-run draining — a
 * queued user message then waits for the run to end and drains into a fresh
 * run (the pre-steering behaviour). Default ON.
 */
export function midRunInterjectEnabled(source?: Record<string, string | undefined>): boolean {
  return envFlag('LOCALIX_MID_RUN_INTERJECT', true, source)
}

/**
 * Truncate to at most `max` UTF-16 units WITHOUT splitting a surrogate pair,
 * so the cut always lands on a code-point (and therefore UTF-8) boundary —
 * a split pair would serialize as invalid bytes on the wire.
 */
export function truncateOnCodePointBoundary(
  text: string,
  max: number,
): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  let end = max
  const last = text.charCodeAt(end - 1)
  // A high surrogate at the cut means we'd split a pair — back off one unit.
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return { text: text.slice(0, end), truncated: true }
}

/**
 * Frame one queued user message for mid-run injection. The persisted
 * transcript row keeps the RAW content (it is a normal user message); only the
 * wire text the in-flight model sees carries this envelope, so the model can
 * tell an interjection from the prompt that started the run.
 */
export function frameInterjection(content: string): string {
  const { text, truncated } = truncateOnCodePointBoundary(content, MAX_INTERJECTION_CHARS)
  const body = truncated
    ? `${text}\n[... message truncated: it exceeded ${MAX_INTERJECTION_CHARS} characters. The full text is in the conversation transcript.]`
    : text
  return `The user sent a message while you were working:\n<user_query>${body}</user_query>`
}

/**
 * Frame a delegator's message (`agents message`) for its child.
 *
 * Not the user's envelope and not the "untrusted update" one every other machine wake gets. The
 * agent that wrote the child's brief is the authority the brief came from, so its word is an
 * AMENDMENT to the assignment — and saying so is the whole point: framed as data, "stop, the
 * endpoint moved to /v2" would be read and politely ignored.
 *
 * One wording for both ways it arrives — mid-step into a running child, or as the prompt of a new
 * run in an idle one — because it is framed once, where it is queued. The last line is the part
 * the child must not miss in either case: whatever it answers is sent back as a report.
 */
export function frameDelegatorMessage(content: string): string {
  const { text, truncated } = truncateOnCodePointBoundary(content, MAX_INTERJECTION_CHARS)
  const body = truncated
    ? `${text}\n[... message truncated: it exceeded ${MAX_INTERJECTION_CHARS} characters.]`
    : text
  return [
    'The agent that delegated your task sent you a message:',
    `<delegator_message>${body}</delegator_message>`,
    'Treat it as an update to your assignment from whoever wrote your brief. End with a report: your final reply is sent back to that agent.',
  ].join('\n')
}
