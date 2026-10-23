/** Synchronous HTTP wire transformations used by the manual redirect transport. */
import { credentialQueryParam } from './auth'
import { type Cookie, mergeCookieHeader, parseSetCookie } from './cookie-jar'
import type { ResponseCookie } from './contracts'
import {
  activePairs,
  bodyIsForm,
  FORM_URLENCODED,
  isMultipart,
  methodAllowsBody,
  type Pair,
  type RequestSpec,
} from './request-spec'
import { redactUrlCredentials } from './request-credentials'

/**
 * The cookies the final response asked the client to store, parsed from its `Set-Cookie` headers.
 *
 * Reuses `parseSetCookie`, and MUST be given the array form (`Headers.getSetCookie()`): folding
 * every cookie into one comma-joined `get('set-cookie')` is lossy, because a comma is legal inside
 * `Expires=Wed, 21 Oct 2015…`. A `Max-Age=0` deletion is dropped rather than surfaced — the facet
 * is "what the client would now hold", and a cookie the server just cleared is not that.
 */
export function finalCookies(setCookies: readonly string[]): ResponseCookie[] {
  const out: ResponseCookie[] = []
  for (const raw of setCookies) {
    const parsed = parseSetCookie(raw)
    if (!parsed || 'deleted' in parsed) continue
    out.push({ name: parsed.name, value: parsed.value })
  }
  return out
}

/**
 * The url as it may be REPORTED — the credential in it replaced by a mask.
 *
 * An `apikey` auth with `addTo: 'query'` puts a resolved secret INTO the url. That is correct on
 * the wire, and a disaster everywhere else: `url` and `hops` are printed to the model (a
 * transcript that gets persisted) and returned to the browser (a devtools network tab). The whole
 * point of `${secret:KEY}` is that the value never leaves this process, and for this one auth type
 * it was walking straight out in the first line of every response.
 *
 * Masked HERE, in the one place that mints both fields, rather than in each reporter — a caller
 * that forgets is exactly how this got shipped in the first place.
 */
export function reportUrl(raw: URL | string, spec: RequestSpec): string {
  const url = new URL(redactUrlCredentials(raw.toString(), 'REDACTED'))
  if (url.username) url.username = 'REDACTED'
  if (url.password) url.password = 'REDACTED'
  const param = credentialQueryParam(spec.auth)
  if (!param) return url.toString()
  if (!url.searchParams.has(param)) return url.toString()
  // ASCII, not the `••••••` the JSON views use: this goes through `URL`, which percent-encodes a
  // bullet into `%E2%80%A2%E2%80%A2…` — six characters of noise where a word should be.
  url.searchParams.set(param, 'REDACTED')
  return url.toString()
}

/** Encode the body per the spec's mimeType. Returns undefined for methods that carry none. */
export function encodeBody(spec: RequestSpec): { body?: BodyInit; contentType?: string } {
  if (!methodAllowsBody(spec.method) || !spec.body) return {}
  const { body } = spec
  if (bodyIsForm(body)) {
    // MULTIPART IS ITS OWN ENCODING, not urlencoded with a different label. `bodyIsForm` is true
    // for both, and this branch used to build `URLSearchParams` and hardcode the urlencoded
    // content-type for either — so a Postman `formdata` import (postman.ts maps it to
    // `multipart/form-data`) went out urlencoded, and the server 400'd or misparsed with nothing
    // saying why. `FormData` lets the runtime write the multipart body AND its boundary; a
    // hand-written `Content-Type: multipart/form-data` with no boundary is unparseable, which is
    // why this returns no contentType and lets fetch set it.
    if (isMultipart(body)) {
      const form = new FormData()
      for (const { name, value } of activePairs(body.form)) form.append(name, value)
      return { body: form }
    }
    const params = new URLSearchParams()
    for (const { name, value } of activePairs(body.form)) params.append(name, value)
    return { body: params.toString(), contentType: FORM_URLENCODED }
  }
  if (typeof body.text !== 'string' || body.text === '') return {}
  return { body: body.text, contentType: body.mimeType }
}

export function toHeaderInit(pairs: readonly Pair[]): Record<string, string> {
  const out: Record<string, string> = {}
  const keys = new Map<string, string>()
  for (const { name, value } of pairs) {
    const lower = name.toLowerCase()
    const existingKey = keys.get(lower)
    if (!existingKey) {
      keys.set(lower, name)
      out[name] = value
      continue
    }
    // Fetch's Headers model combines repeated fields. Preserve that behavior before redirect and
    // cookie processing convert the list to a record; Cookie alone uses its RFC delimiter.
    out[existingKey] = `${out[existingKey]}${lower === 'cookie' ? '; ' : ', '}${value}`
  }
  return out
}

/**
 * A 303 — and, in practice, a 301/302 after a POST — continues as a GET without a body. 307/308
 * preserve the method and body by definition. Following the browser rule here keeps us honest
 * against real APIs rather than the spec's letter.
 */
export function methodAfterRedirect(status: number, method: string): string {
  if (status === 307 || status === 308) return method
  if (status === 303) return 'GET'
  // Fetch/modern browser semantics only rewrite POST for 301/302. A PUT is intentionally
  // idempotent and must not quietly become a GET just because an endpoint moved.
  if ((status === 301 || status === 302) && method === 'POST') return 'GET'
  return method
}

/** Headers describing a body must leave with that body on POST → GET redirects. */
export function stripBodyHeaders(headers: Record<string, string>): Record<string, string> {
  const bodyHeaders = new Set([
    'content-encoding',
    'content-language',
    'content-length',
    'content-location',
    'content-type',
    'transfer-encoding',
  ])
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !bodyHeaders.has(name.toLowerCase())),
  )
}

/**
 * Merge the redirect chain's cookies into the outgoing headers, whatever case `Cookie` is in here
 * (`toHeaderInit` keeps the pair's own spelling, and `appendCookie` writes `Cookie`).
 */
export function withCookies(
  headers: Record<string, string>,
  jar: readonly Cookie[],
): Record<string, string> {
  if (jar.length === 0) return headers
  const key = Object.keys(headers).find((h) => h.toLowerCase() === 'cookie')
  const merged = mergeCookieHeader(key ? headers[key] : undefined, jar)
  if (merged === '') return headers
  return { ...headers, [key ?? 'Cookie']: merged }
}

/** Credentials must not survive a hop to a different origin. */
export function stripAuthAcrossOrigin(
  headers: Record<string, string>,
  from: URL,
  to: URL,
): Record<string, string> {
  if (from.origin === to.origin) return headers
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (lower === 'authorization' || lower === 'cookie') continue
    out[name] = value
  }
  return out
}
