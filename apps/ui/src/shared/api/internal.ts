import { hc, type ClientResponse } from 'hono/client'
import type { ResponseFormat } from 'hono/types'
import type { SuccessStatusCode } from 'hono/utils/http-status'

import { LOCALIX_CLIENT_HEADER, LOCALIX_CLIENT_HEADER_VALUE } from '@localixai/api/client-header'
import { markResponseTrace } from '@localixai/plugin-sdk/ui/transport'
import type { App } from './contracts'
import { getDesktopApiPort } from '@localixai/kit/environment'
import { armDevApiHealth, runtimeReadyBarrier } from '../lib/runtimeReady'

export type ApiRequestPhase = 'started' | 'succeeded' | 'failed' | 'cancelled'
export interface ApiRequestEvent {
  phase: ApiRequestPhase
  traceId: string
  operation: string
  method: string
  ts: number
  durationMs?: number
  attributes: Readonly<Record<string, string | number | boolean | null>>
  error?: unknown
}
type ApiRequestEventHandler = (event: ApiRequestEvent) => void

const apiRequestEventHandlers = new Set<ApiRequestEventHandler>()
let apiRequestSequence = 0

function emitApiRequestEvent(event: ApiRequestEvent): void {
  for (const handler of apiRequestEventHandlers) {
    try {
      handler(event)
    } catch (error) {
      console.error('[apiFetch] request observer threw', error)
    }
  }
}

/** Observer-only transport seam used by application-level tracing. */
export function onApiRequestEvent(handler: ApiRequestEventHandler): () => void {
  apiRequestEventHandlers.add(handler)
  return () => apiRequestEventHandlers.delete(handler)
}

const _desktopPort = getDesktopApiPort()

/** The dev daemon, used whenever the page cannot supply a usable origin of its own. */
const FALLBACK_ORIGIN = 'http://localhost:5050'

/**
 * Is this origin something an absolute http(s) URL can be built from?
 *
 * `window.location.origin` is not always an origin. In an `about:blank`, `srcdoc` or sandboxed
 * frame — and for a `file://` page — it is the literal STRING `"null"`, which then flowed straight
 * into `API_BASE_URL`, and `new URL('null/rpc/ws')` throws `Invalid URL`. The throw surfaced from
 * `wsUrl()` → `connect()` → `retain()`, i.e. out of a subscribe call and into whatever component
 * was mounting, taking that tree down instead of merely leaving realtime unavailable.
 */
function usableOrigin(origin: string | undefined): boolean {
  if (!origin) return false
  try {
    return /^https?:$/u.test(new URL(origin).protocol)
  } catch {
    return false
  }
}

/**
 * The HTTP base for this runtime, as a pure function of its two inputs so the null-origin case is
 * testable without re-evaluating the module.
 */
export function resolveHttpBase(
  pageOrigin: string | undefined,
  desktopPort: number | null | undefined,
): string {
  if (desktopPort) return `http://127.0.0.1:${desktopPort}`
  const origin = usableOrigin(pageOrigin) ? pageOrigin! : FALLBACK_ORIGIN
  return origin.replace(/\/$/, '')
}

export const API_BASE_URL = resolveHttpBase(
  typeof window === 'undefined' ? undefined : window.location.origin,
  _desktopPort,
)

export function resolveWebSocketBase(raw: string): string {
  // An explicitly configured base is used only if it is usable; otherwise fall back to the HTTP
  // base, which `resolveHttpBase` has already validated. Returning a malformed value here would
  // just move the `new URL` throw into `wsUrl()`.
  const trimmed = raw.replace(/\/$/, '')
  const base = usableOrigin(trimmed) ? trimmed : API_BASE_URL
  if (!import.meta.env.DEV || typeof window === 'undefined') return base
  const pageHost = window.location.hostname
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(pageHost)) return base
  try {
    const url = new URL(base)
    url.hostname = pageHost
    return url.origin
  } catch {
    return base
  }
}

// Vite's HTTP proxy does not relay WebSocket upgrades reliably under Bun, so
// the launcher supplies the attested daemon origin directly for WebSockets.
export const WS_BASE_URL = _desktopPort
  ? API_BASE_URL
  : resolveWebSocketBase(import.meta.env.VITE_WS_BASE_URL ?? '')

// A dev build has no shell to say the API is listening; it asks the API itself, on the same
// attested origin the socket uses (the Vite proxy covers only `/rpc`). See `runtimeReady.ts`.
if (import.meta.env.DEV) armDevApiHealth(`${WS_BASE_URL}/health`)

/**
 * THE transport for every API call this app makes.
 *
 * On the packaged desktop the API is a child process the shell spawns while the
 * webview is already painting. Requests issued into that window do not fail
 * because anything is wrong — they fail because the port is not bound yet — and
 * each failure costs a real error state somewhere in the UI. Gating the
 * TRANSPORT means no call site has to know: they simply do not leave until the
 * shell reports its child is listening.
 *
 * A development build holds the same way until the API first answers `/health`.
 * Otherwise (a production browser tab, a settled shell) the barrier is `null` and
 * this is the platform `fetch` with one extra microtask.
 */
function apiRequestMetadata(
  input: RequestInfo | URL,
  init?: RequestInit,
): { method: string; operation: string; path: string } {
  const request = typeof Request !== 'undefined' && input instanceof Request ? input : null
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  let resource = 'api'
  let path = '/api'
  try {
    const segments = new URL(rawUrl, API_BASE_URL).pathname.split('/').filter(Boolean)
    resource = segments[0] === 'rpc' ? (segments[1] ?? 'rpc') : (segments[0] ?? 'api')
    path = segments[0] === 'rpc' ? `/rpc/${resource}` : `/${resource}`
  } catch {
    // Keep the generic label; raw URLs are never persisted.
  }
  return { method, operation: `${method} ${resource}`, path }
}

/**
 * Mark a write as first-party (`@localixai/api/client`'s `LOCALIX_CLIENT_HEADER`).
 *
 * The API refuses a body-less `POST`/`DELETE` that carries neither an allowed `Origin` nor this
 * header, because a foreign page can fire exactly that request with `mode: 'no-cors'` and no
 * preflight. Reads are left untouched: a custom header turns a cross-origin GET from the packaged
 * page into a preflighted one, which would double every read for no protection.
 */
export function withClientHeader(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  method: string,
): RequestInit | undefined {
  if (method === 'GET' || method === 'HEAD') return init
  const request = typeof Request !== 'undefined' && input instanceof Request ? input : null
  // `fetch` takes `init.headers` over the Request's own, so start from whichever it would send.
  const headers = new Headers(init?.headers ?? request?.headers)
  headers.set(LOCALIX_CLIENT_HEADER, LOCALIX_CLIENT_HEADER_VALUE)
  return { ...init, headers }
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const startedAt = Date.now()
  const traceId = `h${++apiRequestSequence}`
  const metadata = apiRequestMetadata(input, init)
  init = withClientHeader(input, init, metadata.method)
  const base = {
    traceId,
    operation: metadata.operation,
    method: metadata.method,
    attributes: { path: metadata.path },
  }
  emitApiRequestEvent({ ...base, phase: 'started', ts: startedAt })
  const barrier = runtimeReadyBarrier()
  try {
    if (barrier) await barrier
    const response = await globalThis.fetch(input, init)
    // So a problem built from this response can name THIS call — see `problemRequestOf`.
    markResponseTrace(response, traceId)
    const ts = Date.now()
    emitApiRequestEvent({
      ...base,
      phase: response.ok ? 'succeeded' : 'failed',
      ts,
      durationMs: ts - startedAt,
      attributes: { ...base.attributes, status: response.status },
      error: response.ok ? undefined : { status: response.status },
    })
    return response
  } catch (error) {
    const ts = Date.now()
    const cancelled = error instanceof Error && error.name === 'AbortError'
    emitApiRequestEvent({
      ...base,
      phase: cancelled ? 'cancelled' : 'failed',
      ts,
      durationMs: ts - startedAt,
      error,
    })
    // Cancellation is the caller's own doing and is matched by name everywhere; it must arrive
    // unchanged. Anything else is the transport failing, and `TypeError: Failed to fetch` is what
    // the user was being shown for it.
    if (cancelled) throw error
    throw transportFailure(error)
  }
}

export const client = hc<App>(API_BASE_URL, { fetch: apiFetch })

// The transport hands a failure to `failure.ts` to be classified, and re-exports what it
// answers with: every caller already imports its error helpers from here.
export { ApiError, apiFailure, errorDetail, failureSentence } from './failure'
import { responseError, transportFailure, type FetchResponse } from './failure'

/**
 * The JSON body of the SUCCESS branches of a typed Hono response.
 *
 * `hc<App>` types every call as a union with one member per status the route can answer. A member
 * counts as a success when its status can be 2xx (`c.json(x)` with no explicit status carries the
 * whole status range, so it counts); one fixed to an error status (`jsonError(c, 404, ...)`) does
 * not. The body is therefore what the route's handler returns, not what a caller believes it does.
 */
export type OkBody<R> = R extends { status: infer S; json(): Promise<infer B> }
  ? [Extract<S, SuccessStatusCode>] extends [never]
    ? never
    : B
  : never

/**
 * Read a typed response's body, or throw the ApiError it describes.
 *
 * The result type COMES FROM THE API. It used to be a type argument at every call
 * (`unwrap<{ toggles: Toggle[] }>(...)`), cast onto whatever JSON arrived, so a route that renamed
 * a field kept compiling in the UI and failed at runtime. Now renaming `toggles` in the route is a
 * type error where the UI reads it. A plain `Response` is refused: its body is `any`, so the caller
 * would silently get no checking. Reading a route through `client.rpc` is the only way in.
 */
export async function unwrap<R extends ClientResponse<unknown, number, ResponseFormat>>(
  response: R,
): Promise<OkBody<R>> {
  if (!response.ok) throw await responseError(response)
  return (await response.json()) as OkBody<R>
}

/** Throw an ApiError if a Response isn't ok — for endpoints with no body to unwrap (DELETE, fire-and-forget POST). */
export async function assertOk(response: FetchResponse): Promise<void> {
  if (response.ok) return
  throw await responseError(response)
}

export function cleanQuery(
  opts?: Record<string, string | number | null | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(opts ?? {})) {
    if (v !== undefined && v !== null && v !== '') out[k] = String(v)
  }
  return out
}
