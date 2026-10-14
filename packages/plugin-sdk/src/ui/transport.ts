import { parsePrerequisite, type Prerequisite } from '../prerequisite'
import type { ProblemRequest } from './problems'

export interface PluginUiTransport {
  /** Execute one request against a validated plugin-owned `/rpc/*` route. */
  request(path: string, init?: RequestInit): Promise<Response>
  /** Resolve a validated route for browser-owned consumers such as links and media elements. */
  url(path: string): string
}

let transport: PluginUiTransport | null = null

/** Bind the host transport before discovering bundled plugin UI modules. */
/** Bind the host transport; the unbind restores the previous one (see `bindPluginUiRuntime`). */
export function bindPluginUiTransport(next: PluginUiTransport): () => void {
  const previous = transport
  transport = next
  return () => {
    if (transport === next) transport = previous
  }
}

function pluginRoute(path: string): string {
  if (!path.startsWith('/rpc/') || path.startsWith('//')) {
    throw new Error(`Plugin UI routes must be relative /rpc/* paths: ${path}`)
  }
  return path
}

function currentTransport(): PluginUiTransport {
  if (!transport) throw new Error('Plugin UI transport is not bound by the host')
  return transport
}

export function pluginApiFetch(path: string, init?: RequestInit): Promise<Response> {
  return currentTransport().request(pluginRoute(path), init)
}

export function pluginApiUrl(path: string): string {
  return currentTransport().url(pluginRoute(path))
}

/**
 * Which client trace each response belongs to.
 *
 * The defect: an Event Center row picked its trace as "the newest failed request in this session
 * within ten seconds", so a Docker problem was filed with a Kubernetes poll's 503 as its cause —
 * the Docker request was in the buffer and was cut. A problem has to NAME its request. The host
 * transport marks every response it returns with the trace id it minted; a plugin reads it back
 * through {@link problemRequestOf}. A WeakMap rather than a request header, because a custom header
 * turns every cross-origin GET from the packaged page into a preflighted one.
 */
const responseTraces = new WeakMap<Response, string>()

/** Host transport only: record the trace id of the call that produced `response`. */
export function markResponseTrace(response: Response, traceId: string): void {
  responseTraces.set(response, traceId)
}

/** The response header the API stamps on every answer; its log lines carry the same id. */
export const REQUEST_ID_HEADER = 'x-request-id'

/** The failed call, as a problem names it — so the Event Center traces exactly this request. */
export function problemRequestOf(response: Response, method?: string): ProblemRequest {
  let path: string | undefined
  try {
    path = response.url ? new URL(response.url).pathname : undefined
  } catch {
    path = undefined
  }
  const traceId = responseTraces.get(response)
  const requestId = response.headers?.get(REQUEST_ID_HEADER) ?? undefined
  return {
    ...(method ? { method: method.toUpperCase() } : {}),
    ...(path ? { path } : {}),
    status: response.status,
    ...(traceId ? { traceId } : {}),
    ...(requestId ? { requestId } : {}),
  }
}

/**
 * A failed plugin request, carrying the three things the route already knew: the sentence, the
 * machine code, and the raw text behind it. `detail` is for the Event Center, never for a surface
 * line — same split as the backend's `toErrorInfo()`.
 */
export class PluginApiError extends Error {
  readonly status: number
  readonly code: string | null
  /** What the engine/driver/parser actually said, when the route sent it. */
  readonly detail?: string
  /** The absent or stopped dependency, when that is what failed. */
  readonly prerequisite?: Prerequisite
  /** The call that failed — pass it on as `Problem.request`. */
  readonly request?: ProblemRequest

  constructor(
    message: string,
    status: number,
    code: string | null = null,
    detail?: string,
    extra: { prerequisite?: Prerequisite; request?: ProblemRequest } = {},
  ) {
    super(message)
    this.name = 'PluginApiError'
    this.status = status
    this.code = code
    if (detail) this.detail = detail
    if (extra.prerequisite) this.prerequisite = extra.prerequisite
    if (extra.request) this.request = extra.request
  }
}

/**
 * The two error bodies a plugin route actually answers with.
 *
 * The host envelope (`jsonError`) is NESTED — `{ error: { code, message, detail } }`. Several
 * plugin routes hand-roll a FLAT one instead — `{ error, code, detail }`, which is what
 * `toErrorInfo()` naturally spreads into. Reading only the nested shape was a miss on every field:
 * a person whose spreadsheet would not open was told "Request failed with status 400" while the
 * sentence naming the reason, and the library's own words, were both on the wire and both thrown
 * away. The documents plugin worked around it with a private copy of this function.
 *
 * So read BOTH. The flat shape is only trusted when `error` is a string — that is what separates
 * it from the nested one, whose `error` is an object.
 *
 * And when a route answers nothing readable at all, the fallback is a SENTENCE, not the status
 * line. `Request failed with status 500` names neither what failed nor what to do; the host's own
 * transport classifies the same statuses this way, and the two must not word one failure
 * differently just because it crossed a plugin boundary.
 */

/** One sentence per status class, matching the host transport's table. */
function statusSentence(status: number): string {
  if (status === 0) return 'Cannot reach the Localix server.'
  if (status === 401 || status === 403) return 'You are not allowed to do that.'
  if (status === 404) return 'That no longer exists.'
  if (status === 408 || status === 504) return 'The server took too long to answer.'
  if (status === 409) return 'Something else changed this first.'
  if (status === 413) return 'That is too large to send.'
  if (status === 429) return 'Too many requests — wait a moment and try again.'
  if (status >= 500) return 'The server could not complete this.'
  return 'The server rejected this request.'
}
type JsonError = {
  error?: string | { code?: string; message?: string; detail?: string; prerequisite?: unknown }
  code?: string
  detail?: string
  prerequisite?: unknown
}

interface WireError {
  message: string
  code: string | null
  detail?: string
  prerequisite?: Prerequisite
}

function readWireError(body: JsonError | null, status: number): WireError {
  const nested = body && typeof body.error === 'object' ? body.error : null
  if (nested) {
    return {
      message: nested.message ?? statusSentence(status),
      code: nested.code ?? null,
      detail: nested.detail,
      prerequisite: parsePrerequisite(nested.prerequisite) ?? undefined,
    }
  }
  const flat = body && typeof body.error === 'string' ? body.error : null
  return {
    message: flat ?? statusSentence(status),
    code: body?.code ?? null,
    detail: body?.detail,
    prerequisite: parsePrerequisite(body?.prerequisite) ?? undefined,
  }
}

async function pluginApiError(response: Response): Promise<PluginApiError> {
  const body = (await response.json().catch(() => null)) as JsonError | null
  const wire = readWireError(body, response.status)
  return new PluginApiError(wire.message, response.status, wire.code, wire.detail, {
    prerequisite: wire.prerequisite,
    request: problemRequestOf(response),
  })
}

export async function unwrapPluginResponse<T>(response: Response): Promise<T> {
  if (!response.ok) throw await pluginApiError(response)
  return (await response.json()) as T
}

export async function assertPluginResponse(response: Response): Promise<void> {
  if (response.ok) return
  throw await pluginApiError(response)
}

/**
 * The RAW text behind a classified failure, or undefined when the thrown value carried none.
 *
 * Pairs with a caller-written sentence: the caller knows which operation the person asked for and
 * no server string can say that, while the raw body is the only place a CLI's four lines of
 * `error:`/`hint:` survive. Reading `.message` instead would print the classification twice and
 * discard everything past its first line.
 */
export function pluginErrorDetail(error: unknown): string | undefined {
  return error instanceof PluginApiError ? error.detail : undefined
}

/**
 * Everything a thrown request failure knows that a {@link Problem} can carry — its code, the raw
 * text, the failed call and an absent dependency — so a plugin's problem builder spreads one value
 * instead of reading four fields (and forgetting the one that links the row to its request).
 */
export function pluginFailureFacts(error: unknown): {
  code?: string
  detail?: string
  request?: ProblemRequest
  prerequisite?: Prerequisite
} {
  if (!error || typeof error !== 'object') return {}
  const e = error as {
    code?: unknown
    detail?: unknown
    request?: unknown
    prerequisite?: unknown
  }
  const prerequisite = parsePrerequisite(e.prerequisite)
  return {
    ...(typeof e.code === 'string' && e.code ? { code: e.code } : {}),
    ...(typeof e.detail === 'string' && e.detail ? { detail: e.detail } : {}),
    ...(e.request && typeof e.request === 'object' ? { request: e.request as ProblemRequest } : {}),
    ...(prerequisite ? { prerequisite } : {}),
  }
}

export function postPluginJson(path: string, body: unknown): Promise<Response> {
  return pluginApiFetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function cleanPluginQuery(
  values?: Record<string, string | number | null | undefined>,
): Record<string, string> {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(values ?? {})) {
    if (value !== undefined && value !== null && value !== '') query[key] = String(value)
  }
  return query
}
