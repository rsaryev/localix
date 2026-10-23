/**
 * What the send path throws, WITH its classification attached.
 *
 * `errors.ts` used to recover the classification by running regexes over the message:
 *
 *   if (/private\/internal address|points at the local machine|Too many redirects/i.test(message))
 *   if (/Invalid URL|not an http/i.test(message))
 *   …otherwise network_error
 *
 * and its comment explained why that was fine — "the messages matched here are OURS, so this is
 * reading our own vocabulary, not sniffing Node's". True, and it still broke, because a vocabulary
 * only stays shared if someone keeps it shared. Three errors were added to `send.ts` over three
 * commits and not one of them matched a regex living in a different file. Measured:
 *
 *   502 network_error   a timeout                       (should be 504 timeout)
 *   502 network_error   a url with no scheme            (should be 400 — the user's typo)
 *   502 network_error   a refused file:// url           (should be 403 — we blocked it)
 *   502 network_error   an unfilled :id placeholder     (should be 400)
 *   502 network_error   an unparseable url              (should be 400)
 *
 * Seven of eight cases said `502 network_error` — "the upstream is broken" — when the upstream had
 * not been contacted at all. The workbench told people an API was down because they mistyped a url.
 *
 * That is the same shape as every other bug this mini app has produced: one piece of knowledge in
 * two places, and only one of them gets updated. The cure is the same too — stop keeping it in two
 * places. An error now carries the code it means, and `mapRestError` reads it instead of guessing.
 *
 * This module exists rather than `send.ts` importing `errors.ts` because the dependency runs the
 * other way: `errors.ts` is the ROUTE's vocabulary (it builds the `{error, code, detail}` body),
 * and the wire has no business knowing a route exists. Both import this.
 */

/**
 * The subset of the mini app's error codes a send can produce.
 *
 * Deliberately NOT re-exported from `contracts.ts`'s `RestErrorCode`: `request_not_found` and
 * `secret_unavailable` happen before a send starts and are not this module's to name. Keeping the
 * union narrow means a wrong code here is a compile error rather than a 502.
 */
export type SendErrorCode = 'bad_request' | 'blocked' | 'timeout' | 'network_error'

/**
 * A send refused or failed, and it says what KIND without anybody parsing English.
 *
 * The codes carry real meaning downstream — the route turns them into a status, and the UI
 * branches on them: `blocked` must not offer a retry (we will refuse it again), `timeout` should,
 * `bad_request` means fix the request rather than the server.
 */
export class SendError extends Error {
  readonly code: SendErrorCode

  constructor(code: SendErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SendError'
    this.code = code
  }
}

/**
 * The request took longer than `timeoutMs`.
 *
 * Its own class because the TOOL path tells it from a user abort with `instanceof` — `fetch`
 * reports both as an AbortError, and only one of the two is worth retrying.
 */
export class RequestTimeoutError extends SendError {
  constructor(message: string) {
    super('timeout', message)
    this.name = 'RequestTimeoutError'
  }
}
