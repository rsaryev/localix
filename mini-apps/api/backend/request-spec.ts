/**
 * The REQUEST grammar — the one vocabulary the agent tool, the saved-request store and
 * the workbench UI all speak. Pure: no fetch, no zod, no storage, so every side can import it
 * without dragging the others' world in.
 *
 * The shape keeps imported request fields close to their stored representation. An auth type is
 * listed only when `auth.ts` can sign it; accepting an auth type that cannot execute would defer a
 * predictable failure until send time.
 *
 * Parsing is tolerant (an agent writes `get`, `GET`, or ` Get `), but FORMATTING is canonical —
 * every accepted spelling round-trips to exactly one method, so a saved request can never exist
 * twice under two spellings.
 */

/** Methods with a well-defined meaning in HTTP. `body` is only sent for those that allow one. */
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

export type HttpMethod = (typeof HTTP_METHODS)[number]

/** Methods that carry a request body. HEAD/GET/OPTIONS bodies are ignored rather than rejected. */
const BODYLESS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS'])

export function methodAllowsBody(method: HttpMethod): boolean {
  return !BODYLESS.has(method)
}

/** Tolerant parse → canonical method, or null when it isn't one we speak. */
export function parseMethod(raw: string | undefined): HttpMethod | null {
  const m = raw?.trim().toUpperCase()
  if (!m) return null
  return (HTTP_METHODS as readonly string[]).includes(m) ? (m as HttpMethod) : null
}

/**
 * Auth. Each variant's secret-bearing fields may hold a `${secret:KEY}` token instead of a
 * literal — `secrets.ts` resolves them at send time, so a saved request never stores a
 * credential in plaintext.
 */
export interface AuthNone {
  type: 'none'
}
export interface AuthBasic {
  type: 'basic'
  username: string
  password: string
}
export interface AuthBearer {
  type: 'bearer'
  token: string
  /** Scheme written before the token; defaults to `Bearer`. */
  prefix?: string
}
export interface AuthApiKey {
  type: 'apikey'
  key: string
  value: string
  /** Where the pair is written. Defaults to `header`. */
  addTo?: 'header' | 'query' | 'cookie'
}

export type RequestAuth = AuthNone | AuthBasic | AuthBearer | AuthApiKey

export const AUTH_TYPES = ['none', 'basic', 'bearer', 'apikey'] as const

/** A name/value pair that can be switched off without being deleted (headers, query, form). */
export interface Pair {
  name: string
  value: string
  disabled?: boolean
}

/**
 * The request body. Exactly one of `text` / `form` is meaningful, selected by `mimeType`:
 * an `application/x-www-form-urlencoded` or `multipart/form-data` body reads `form`; anything else
 * reads `text`.
 */
export interface RequestBody {
  mimeType?: string
  text?: string
  form?: Pair[]
}

export interface RequestSpec {
  url: string
  method: HttpMethod
  headers: Pair[]
  query: Pair[]
  body?: RequestBody
  auth: RequestAuth
  /**
   * Values for the `:name` placeholders in `url`. Absent on a request with no placeholders, which
   * is most of them.
   */
  pathParameters?: Pair[]
  /** Follow 3xx responses. Each hop is re-checked against the SSRF guard. Defaults to true. */
  followRedirects?: boolean
  /**
   * Per-request send overrides. Absent means "use the mini app's configured default" — these do NOT
   * duplicate the config, they OVERRIDE it for the one request that sets them (a slow report that
   * needs 60s, an endpoint whose redirect chain is longer than the global cap). `timeoutMs` bounds
   * the WHOLE chain, not each hop; `maxRedirects` caps how many hops are followed before the send
   * is refused as a loop.
   */
  timeoutMs?: number
  maxRedirects?: number
}

/**
 * A `:name` path placeholder occupying a whole segment. One placeholder syntax across URL, store,
 * and UI prevents import and send paths from disagreeing.
 *
 * Anchored on `/` so a `:` inside a segment is left alone: `https://host:8443/x` must not read
 * its port as a parameter, and neither must a `urn:foo` in a path.
 */
export const PATH_PARAM_RE = /\/:[^/?#:]+/g

/**
 * Substitute `:name` placeholders with their values, url-encoding each.
 *
 * An unfilled placeholder is left AS-IS rather than replaced with an empty segment. `/users/:id`
 * with no id is visibly unfinished; `/users/` is a different, real endpoint that would return
 * something plausible and wrong. Failing to look right beats succeeding at the wrong request.
 */
export function applyPathParams(url: string, params: readonly Pair[] | undefined): string {
  if (!params?.length) return url
  const byName = new Map(activePairs(params).map((p) => [p.name, p.value]))
  return url.replace(PATH_PARAM_RE, (match) => {
    const value = byName.get(match.slice(2))
    return value ? `/${encodeURIComponent(value)}` : match
  })
}

export {
  credentialQueryPairs,
  credentialUrlParams,
  redactUrlCredentials,
  credentialHeaders,
} from './request-credentials'

export const FORM_URLENCODED = 'application/x-www-form-urlencoded'
export const MULTIPART_FORM = 'multipart/form-data'

function bareMime(body: RequestBody | undefined): string | undefined {
  return body?.mimeType?.split(';')[0]?.trim().toLowerCase()
}

/** A body whose payload is `form[]` rather than `text` — either encoding. */
export function bodyIsForm(body: RequestBody | undefined): boolean {
  const mime = bareMime(body)
  return mime === FORM_URLENCODED || mime === MULTIPART_FORM
}

/**
 * A form body that must be MULTIPART on the wire.
 *
 * The distinction `bodyIsForm` does not make, and for a while nothing else did either: both
 * encodings read `form[]`, so `encodeBody` treated them as one and sent multipart url-encoded
 * under the urlencoded content-type. Same input shape, different bytes.
 */
export function isMultipart(body: RequestBody | undefined): boolean {
  return bareMime(body) === MULTIPART_FORM
}

/** Enabled pairs only, in order. The single place `disabled` is honoured. */
export function activePairs(pairs: readonly Pair[] | undefined): Pair[] {
  return (pairs ?? []).filter((p) => !p.disabled && p.name.trim() !== '')
}

/**
 * Build the final URL: the spec's `url` with its path parameters filled, plus its enabled query
 * pairs. Pairs are APPENDED to any query string already written into the url, so `?a=1` in the url
 * and `{name:'b'}` in `query` both survive — dropping either would silently change the request the
 * user wrote.
 *
 * Path params are substituted HERE, in the one place a url is built, so the string the SSRF guard
 * checks and the string fetch calls are the same one. Substituting later — after the guard — is
 * how a parameter becomes a way past it.
 */
export function buildUrl(spec: Pick<RequestSpec, 'url' | 'query' | 'pathParameters'>): URL {
  const url = new URL(applyPathParams(spec.url, spec.pathParameters))
  for (const { name, value } of activePairs(spec.query)) {
    url.searchParams.append(name, value)
  }
  return url
}

export { isHttpUrl, urlProblem } from './request-url-policy'

/**
 * The `:name` placeholders in `url` that WOULD BE SENT LITERALLY — no value, or an empty one.
 *
 * A url keeps two kinds of placeholder and, until now, only one of them was ever checked.
 * `{{base_url}}` unresolved is refused with a sentence naming the variable and the call that
 * defines it (`missingVarsProblem`). An unfilled `:id` was sent as the four characters `/:id`:
 *
 *   /u/:id                     no params        → GET https://api.dev/u/:id
 *   /u/:id                     id = ""          → GET https://api.dev/u/:id
 *   /u/:id/posts/:postId       id = 42          → GET https://api.dev/u/42/posts/:postId
 *   /u/:id                     wrong = 42       → GET https://api.dev/u/:id
 *
 * All measured. The last is the one that stings: a value WAS supplied, the name did not match, and
 * we dropped it and sent the placeholder. The third is worse than a 404: a half-substituted path
 * can be a real route on some servers. Both are silent and plausible, which is what makes them
 * expensive.
 *
 * This reads the SAME `PATH_PARAM_RE` that `applyPathParams` substitutes with, deliberately. The
 * report and the substitution must not be able to disagree about what a placeholder is — a second
 * regex saying the same thing is the `pairValue` lesson (the same knowledge in three copies, one
 * of them untested and free to drift) waiting to happen.
 */
export function unfilledPathParams(
  url: string,
  pathParameters: readonly Pair[] | undefined,
): string[] {
  const byName = new Map(activePairs(pathParameters).map((p) => [p.name, p.value]))
  const unfilled = new Set<string>()
  for (const match of url.match(PATH_PARAM_RE) ?? []) {
    const name = match.slice(2)
    // Truthiness, not `has`: `applyPathParams` leaves an EMPTY value unsubstituted too, so an
    // empty value is unfilled by the only definition that matters — what reaches the server.
    if (!byName.get(name)) unfilled.add(name)
  }
  return [...unfilled]
}

/**
 * The sentence for unfilled `:name` path placeholders — the sibling of `missingVarsProblem`.
 *
 * It sits beside that one, and is worded like it, because to the person on the other end these are
 * the same situation: a placeholder in the url with nothing to put in it. Only the syntax differs.
 * The asymmetry — one refused with instructions, the other sent verbatim to a server — was not a
 * decision anybody made; `:id` simply never got the check `{{id}}` got.
 */
export function unfilledPathParamsProblem(unfilled: readonly string[], url: string): string {
  const names = unfilled.map((m) => `\`:${m}\``).join(', ')
  const one = unfilled.length === 1
  return (
    `The url "${url}" has ${one ? 'a path placeholder' : 'path placeholders'} ${names} with no value, ` +
    `so ${one ? 'it' : 'they'} would be sent to the server as literal text. ` +
    `Pass ${one ? 'it' : 'them'} with "pathParams", e.g. ` +
    `{"action":"send","pathParams":[${unfilled.map((n) => `{"name":"${n}","value":"…"}`).join(',')}]}. ` +
    'A name must match the placeholder exactly — a mismatched one is ignored, which is how a ' +
    'supplied value ends up not being used.'
  )
}
