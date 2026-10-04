/**
 * THE abort error. One producer, because there is exactly one consumer contract.
 *
 * Cancellation is detected by NAME, nowhere else: `classifyAgentError` keys
 * `kind: 'abort', retryable: false` off `error.name === 'AbortError'`, and the
 * OpenAI fetch retry ladder refuses to retry on the same string. Nothing type-checks
 * that string. A wire that hand-rolls `new DOMException('Aborted', 'AbortError')` is
 * therefore coupled to the classifier by a literal it re-typed by hand — and if either
 * side ever moves, a user's Stop silently becomes a "fatal error", or a cancelled turn
 * silently becomes a retry. No test would fail. Same defect class, and same fix, as
 * Kept in the framework-neutral package because browser and server consumers
 * need the same cancellation shape.
 *
 * So the shape is produced HERE, and every wire — in-package and drop-in (which reaches
 * it as `ctx.host.wire.makeAbortError`) — asks for it. Guarded structurally by
 *
 * The result is a plain `Error`, not a `DOMException`: both satisfy the
 * `instanceof Error && name === 'AbortError'` contract that every consumer actually
 * checks, and `Error` is the one shape available in every runtime a wire runs in.
 */

/** An `Error` named `AbortError` — the shape every cancellation check in the loop matches. */
export function makeAbortError(message = 'Aborted'): Error {
  const err = new Error(message)
  err.name = 'AbortError'
  return err
}
