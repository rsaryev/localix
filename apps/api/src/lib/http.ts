import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { defaultErrorHandler, isApiError, jsonError } from '@localixai/mini-app-sdk/backend'
import type { Logger } from './logger'
import { requestIdOf } from './request-id'

export { defaultErrorHandler, jsonError }

/** The statuses a client fault may keep; anything else Hono raises is a plain bad request. */
const CLIENT_FAULT_CODES: Partial<Record<number, string>> = {
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'validation_error',
}

/**
 * The ROOT `onError` handler — the terminal counterpart to
 * {@link defaultErrorHandler}. A feature router re-throws what it does not
 * recognize; this is what catches it, and it must answer EVERYTHING.
 *
 * Its one real rule: **a client fault must never be reported as a 500.** Hono
 * raises an `HTTPException` for faults it detects before our handlers ever run —
 * most commonly a malformed JSON request body. Those are bad input, not a server
 * crash: masking them as 500s pollutes the error log and misreports the cause to
 * the caller. So an HTTPException keeps its status when that status is one a
 * client fault can legitimately carry, and otherwise degrades to 400 — never up
 * to 500.
 *
 * Only a genuinely unrecognized throw is logged and answered 500, which is what
 * makes that log line worth reading.
 */
export function createRootErrorHandler(logger: Logger) {
  return (error: unknown, c: Context) => {
    // `detail` rides along, exactly as `defaultErrorHandler` does it: a route that took the
    // trouble to separate its sentence from the engine's raw words must not have the raw half
    // dropped by the handler that happens to catch it.
    if (isApiError(error))
      return jsonError(c, error.status, error.code, error.message, error.detail)

    if (error instanceof HTTPException) {
      const status = CLIENT_FAULT_CODES[error.status]
        ? (error.status as 401 | 403 | 404 | 409 | 422)
        : 400
      return jsonError(c, status, CLIENT_FAULT_CODES[status] ?? 'bad_request', error.message)
    }

    // The stack and the request id: "Unexpected server error" is all the caller gets, so this line
    // is the only place the failure can be diagnosed — it must say where, not just what.
    const requestId = requestIdOf(c)
    logger.error({
      event: 'request.failed',
      method: c.req.method,
      path: c.req.path,
      ...(requestId ? { requestId } : {}),
      error: error instanceof Error ? error.message : 'Unknown error',
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    })
    return jsonError(c, 500, 'internal_error', 'Unexpected server error')
  }
}
