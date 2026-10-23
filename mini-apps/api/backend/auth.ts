/**
 * Applying auth to an outgoing request. Pure and secret-free: `applyAuth` runs AFTER
 * `secrets.ts` has swapped every `${secret:KEY}` token for its literal, so this module never
 * touches the vault and a unit test can cover every scheme with no host at all.
 *
 * Auth is applied to a COPY of the headers/url — the caller's RequestSpec is never mutated, so
 * a saved request re-sent twice signs from the same base both times.
 */

import { activePairs, type Pair, type RequestAuth, type RequestSpec } from './request-spec'

export interface SignedRequest {
  url: URL
  headers: Pair[]
}

/** Case-insensitive header set: auth overwrites a same-named header rather than duplicating it. */
function setHeader(headers: Pair[], name: string, value: string): Pair[] {
  const lower = name.toLowerCase()
  const kept = headers.filter((h) => h.name.toLowerCase() !== lower)
  return [...kept, { name, value }]
}

function appendCookie(headers: Pair[], pair: string): Pair[] {
  const existing = headers.find((h) => h.name.toLowerCase() === 'cookie')
  const value = existing?.value ? `${existing.value}; ${pair}` : pair
  return setHeader(headers, 'Cookie', value)
}

/** `Basic base64(user:pass)`, per RFC 7617. */
export function basicHeaderValue(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`
}

/**
 * Write `auth` into a copy of the request's url + headers.
 *
 * `url` is taken pre-built (see `buildUrl`) because an apikey placed in the query has to land on
 * the SAME url the SSRF guard checked and fetch will call — signing a different url than we
 * vetted is how a guard gets bypassed.
 */
export function applyAuth(auth: RequestAuth, url: URL, headers: readonly Pair[]): SignedRequest {
  const out = new URL(url)
  let next = [...headers]

  switch (auth.type) {
    case 'none':
      break
    case 'basic':
      next = setHeader(next, 'Authorization', basicHeaderValue(auth.username, auth.password))
      break
    case 'bearer': {
      const prefix = auth.prefix?.trim() || 'Bearer'
      next = setHeader(next, 'Authorization', `${prefix} ${auth.token}`)
      break
    }
    case 'apikey': {
      const addTo = auth.addTo ?? 'header'
      if (addTo === 'query') out.searchParams.set(auth.key, auth.value)
      else if (addTo === 'cookie') next = appendCookie(next, `${auth.key}=${auth.value}`)
      else next = setHeader(next, auth.key, auth.value)
      break
    }
  }
  return { url: out, headers: next }
}

/**
 * The query parameter this auth puts a CREDENTIAL into, or null when it puts none there.
 *
 * Only `apikey` with `addTo: 'query'` does — every other variant carries its secret in a header,
 * which is never echoed back. Exported so `send.ts` can mask exactly that parameter out of the url
 * it reports, without knowing anything else about auth.
 */
export function credentialQueryParam(auth: RequestAuth): string | null {
  return auth.type === 'apikey' && auth.addTo === 'query' ? auth.key : null
}

/** The header list a request actually sends, with auth applied and disabled pairs dropped. */
export function finalHeaders(spec: RequestSpec, url: URL): SignedRequest {
  return applyAuth(spec.auth, url, activePairs(spec.headers))
}
