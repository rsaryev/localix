import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'

/**
 * What a failed call MEANS, separated from how it travelled.
 *
 * `internal.ts` owns the transport — base URLs, `fetch`, the typed client. This module
 * owns the other half: turning whatever came back (a JSON envelope, an HTML error page,
 * a machine code, a `TypeError` from a socket that never connected) into one sentence a
 * person can act on, with the original text kept as `detail` for the Event Center.
 *
 * The two are split because they fail differently: a change to a base URL is never a
 * change to what a 409 says, and the classification below is what every feature reads
 * through `failureSentence`.
 */

/** The one sentence for "the request never reached anything". */
const TRANSPORT_UNREACHABLE = 'Cannot reach the Localix server.'

const rawText = (error: unknown): string | undefined =>
  error instanceof Error ? `${error.name}: ${error.message}` : undefined

/**
 * The failure of a request that never reached anything.
 *
 * A dropped socket surfaces as `TypeError: Failed to fetch`, which is what people were
 * shown for "the server is not running". The cause is kept as `detail` — it is the only
 * text there is, and an operator needs it.
 */
export function transportFailure(error: unknown): ApiError {
  return new ApiError(TRANSPORT_UNREACHABLE, 0, 'network', rawText(error))
}

export class ApiError extends Error {
  status: number
  code: string | null
  /**
   * What the server (or the transport) actually said, when that text was not fit to be the
   * message — an HTML error page, a machine code, a fetch's `TypeError`. Event Center only:
   * an operator loses nothing, and nobody reads it on a surface line.
   */
  detail?: string

  constructor(message: string, status: number, code: string | null = null, detail?: string) {
    super(message)
    this.status = status
    this.code = code
    this.detail = detail
  }
}

/**
 * The raw text behind a failure, when the transport kept one — the exact server body, the fetch's
 * `TypeError`. Belongs in a problem's `detail`, never on the line; `undefined` for anything the
 * transport did not classify, because then `.message` IS the original text.
 */
export const errorDetail = (error: unknown): string | undefined =>
  error instanceof ApiError ? error.detail : undefined

/**
 * The most specific sentence available for a failed call.
 *
 * `errorMessage(error, fallback)` prefers whatever is on the error, so a caller's own sentence was
 * dropped the moment the error carried any message at all — which is how a person got a bare `409`
 * with no clue which action produced it. Three cases, in order of what each source actually knows:
 * a message the SERVER wrote knows the most and wins; a message this module CLASSIFIED (and so
 * kept the original in `detail`) knows only the status, and the caller — who knows the operation —
 * wins instead; except when nothing was reached at all, where the cause is the whole story.
 */
export function failureSentence(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.detail !== undefined) {
    return error.status === 0 ? error.message : fallback
  }
  return errorMessage(error, fallback)
}

/**
 * The two error bodies a route actually answers with — the same pair the SDK's
 * `unwrapMiniAppResponse` reads, and read here the same way so core and plugin calls cannot
 * disagree about what the server said. The host envelope is NESTED
 * (`{ error: { code, message, detail } }`); several routes hand-roll a FLAT one
 * (`{ error, code, detail }`), which is what `toErrorInfo()` spreads into. The flat shape is
 * trusted only when `error` is a string — that is what tells the two apart.
 */
type JsonError = {
  error?: string | { code?: string; message?: string; detail?: string }
  code?: string
  detail?: string
}

/**
 * A status code is not a sentence.
 *
 * `Request failed with status 500` reached people verbatim — every call site flattens an error to
 * `.message`, so whatever this constructor puts there is what the product says out loud. The
 * classification belongs in the one place that knows a request failed and how.
 */
function httpFailureSentence(status: number): string {
  if (status === 401 || status === 403) return 'You are not allowed to do that.'
  if (status === 404) return 'That no longer exists.'
  if (status === 408 || status === 504) return 'The server took too long to answer.'
  if (status === 409) return 'Something else changed this first.'
  if (status === 413) return 'That is too large to send.'
  if (status === 429) return 'Too many requests at once — wait a moment and try again.'
  if (status >= 500) return 'The server could not complete this.'
  if (status >= 400) return 'The server rejected this request.'
  return TRANSPORT_UNREACHABLE
}

/**
 * A machine code where a sentence goes — `not_tabular`, `VAULT_LOCKED`, `ENOENT`. A route that
 * answers one has classified nothing, so the status reads better than forwarding it; the code
 * itself is still exact, and stays in `detail`.
 */
const looksLikeCode = (text: string): boolean =>
  !/\s/u.test(text) && (/[_.:]/u.test(text) || text === text.toLocaleUpperCase())

/**
 * A failure the server described, in the app's voice.
 *
 * `served` is whatever the route put in the message slot and `raw` the whole thing it sent. When
 * the route answered a sentence, that sentence wins — it knows more than a status code does. When
 * it answered a code, a status line or nothing, the status is classified here and the exact text
 * is kept in `detail`. Exported because the realtime socket carries the same failures as HTTP and
 * must not word them differently.
 */
export function apiFailure(
  served: string | undefined,
  status: number,
  code: string | null = null,
  raw = served,
): ApiError {
  const sentence = served?.trim() && !looksLikeCode(served.trim()) ? served.trim() : undefined
  return new ApiError(
    sentence ?? httpFailureSentence(status),
    status,
    code,
    sentence ? undefined : raw?.trim() || undefined,
  )
}

/**
 * A fetch answer, as the failure readers use it. The typed RPC client returns its own response
 * type, which lacks members Bun adds to `Response` (`textStream`); taking only what is read
 * accepts both.
 */
export type FetchResponse = Pick<Response, 'ok' | 'status' | 'json' | 'text'>

/** The failure a non-ok response describes, read once so an unparseable body survives as detail. */
export async function responseError(response: FetchResponse): Promise<ApiError> {
  const raw = (await response.text().catch(() => '')).trim()
  let parsed: JsonError | null = null
  try {
    parsed = raw ? (JSON.parse(raw) as JsonError) : null
  } catch {
    // Not JSON — an HTML error page or a proxy's plain text. `raw` still carries it.
  }
  const nested = parsed && typeof parsed.error === 'object' ? parsed.error : null
  const flat = parsed && typeof parsed.error === 'string' ? parsed.error : undefined
  const served = nested ? nested.message : flat
  const code = (nested ? nested.code : parsed?.code) ?? null
  // A route that already separated its sentence from the engine's own words has done this
  // module's job for it: keep both rather than re-deriving either from the whole body.
  const detail = (nested ? nested.detail : parsed?.detail)?.trim()
  return detail
    ? new ApiError(
        served?.trim() || httpFailureSentence(response.status),
        response.status,
        code,
        detail,
      )
    : apiFailure(served, response.status, code, raw)
}
