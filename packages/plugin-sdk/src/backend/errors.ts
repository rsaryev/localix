/**
 * A route failure with an HTTP status attached.
 *
 * `message` is contracted to be ONE HUMAN SENTENCE — the same slot as `Problem.message`, and the
 * same rule: never a machine code, never a bare status, never a driver's raw output. When the
 * engine/CLI/parser said something more specific, pass it as `detail`; `jsonError` puts it on the
 * wire beside the sentence and the client keeps it for the Event Center. That mirrors
 * `toErrorInfo()` in `typed-error.ts`, which is where a subsystem with a code→sentence map should
 * start instead of hand-rolling one here.
 */
export class ApiError extends Error {
  status: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503
  code: string
  /** The raw engine/CLI text behind {@link message}, when there is one. Operators only. */
  detail?: string

  constructor(
    status: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503,
    code: string,
    message: string,
    detail?: string,
  ) {
    super(message)
    this.status = status
    this.code = code
    this.name = 'ApiError'
    if (detail) this.detail = detail
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

/** The human-readable message of any caught value: `Error.message`, else `String(e)`. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
