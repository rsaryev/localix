/**
 * Typed errors for this mini app's routes, built on the SDK's `defineTypedError` kit rather than a
 * hand-rolled class — the same seam trading's `errors.ts` crosses, so the `{ error, code, detail }`
 * body shape and its friendly/raw split have one owner.
 *
 * The point of a CODE is that the UI branches on it. A blocked private-network target is not a
 * network failure and must not be offered a "retry"; a timeout is worth retrying; a missing
 * request is a 404 the sidebar can quietly reconcile.
 */

import { defineTypedError } from '@localixai/mini-app-sdk/backend'
import type { RestErrorCode } from './contracts'
import { SendError } from './send-errors'

export const { DomainError: RestError, toErrorInfo } = defineTypedError<RestErrorCode>(
  'RestError',
  {
    request_not_found: 'No saved request by that name.',
    name_taken: 'A request by that name already exists.',
    blocked: 'That host is blocked as private or internal.',
    timeout: 'The request timed out.',
    network_error: 'The request could not reach the server.',
    secret_unavailable: 'A stored secret this request needs could not be read.',
    bad_request: 'The request could not be sent as written.',
  },
)

/**
 * Classify an unknown throw from the send path.
 *
 * A `SendError` ANSWERS, it is not interrogated. This used to be regexes over the message, and the
 * comment defending that said the messages were ours — "reading our own vocabulary, not sniffing
 * Node's". Which was true, and broke anyway: a vocabulary is only shared while someone keeps it
 * shared, and three errors were added to `send.ts` over three commits without one of them matching
 * a pattern that lives in this file. Measured — seven of eight cases came out `502 network_error`,
 * "the upstream is broken", for requests the upstream never saw: a timeout, a mistyped url, a
 * `file://` we refused ourselves, an unfilled `:id`. The workbench told people an API was down
 * because they forgot `https://`.
 *
 * So the send path carries its own code (`send-errors.ts`) and this reads it. What is left below
 * is a fallback for throws we do NOT mint: `secrets.ts`'s messages, and whatever `fetch` raises.
 * Those are genuinely somebody else's strings, which is the only situation a regex belongs in.
 */
export function mapRestError(err: unknown): InstanceType<typeof RestError> {
  if (err instanceof RestError) return err
  if (err instanceof SendError) return new RestError(err.code, err.message, { cause: err })
  const message = err instanceof Error ? err.message : String(err)

  if (err instanceof Error && err.name === 'AbortError') {
    return new RestError('timeout', message, { cause: err })
  }
  if (/secrets store is unavailable|Secret not found/i.test(message)) {
    return new RestError('secret_unavailable', message, { cause: err })
  }
  // A fetch that fails for any other reason is a network fact, not a bug in the request.
  return new RestError('network_error', message, { cause: err })
}

/**
 * `blocked` is a 403, not a 400: the request was well-formed and we refused it. `timeout` is 504
 * — the upstream did not answer in time, which is exactly what a gateway timeout means.
 */
export function statusFor(err: unknown): 400 | 403 | 404 | 409 | 502 | 504 {
  switch (mapRestError(err).code) {
    case 'request_not_found':
      return 404
    case 'name_taken':
      return 409
    case 'blocked':
      return 403
    case 'timeout':
      return 504
    case 'network_error':
      return 502
    case 'secret_unavailable':
    case 'bad_request':
      return 400
  }
}
