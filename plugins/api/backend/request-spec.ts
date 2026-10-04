/**
 * The REQUEST grammar — the one vocabulary the agent tool, the saved-request store and (later)
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

import type { SendErrorCode } from './send-errors'

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
   * Per-request send overrides. Absent means "use the plugin's configured default" — these do NOT
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

/**
 * Headers that ARE credentials, by definition rather than by guess.
 *
 * The distinction this list exists to make: "is `X-Trace: abc123` a secret?" is a guess, and a
 * guess that says yes blocks real work while one that says no lends false confidence. But
 * `Authorization` and `Cookie` are not guesses — the HTTP specs define them as credentials, and
 * nothing else legitimately lives there.
 *
 * That distinction was WRONG for fourteen iterations. `gitSafetyProblem` and `redactAuth` both
 * reasoned about `spec.auth` only, defended by "auth is the one place this plugin promises to hold
 * credentials" — while `import/har.ts` and `import/curl.ts` deliberately route credentials into
 * HEADERS instead (a HAR keeps its `Authorization` verbatim and folds cookies into one; curl keeps
 * an auth scheme it cannot sign, e.g. GitHub's own `Authorization: Token …`). Each module's comment
 * was true of itself; none was true of the composition.
 */
/**
 * Beyond the three the HTTP specs define, an API-KEY header is a credential by its own NAME. That is
 * still not a guess: `x-api-key` is AWS API Gateway's documented key header, `api-key` is Azure's and
 * OpenAI-compatible servers', `x-goog-api-key` is Google's, `x-amz-security-token` carries an STS
 * session token, and `private-token` is GitLab's. A header called `x-refresh-token` announces what it
 * holds. None of them can be anything else, which is exactly the test the list above applies to
 * `Authorization` — so excluding them was drawing the line by SPEC PROVENANCE rather than by whether
 * the name is ambiguous.
 *
 * `x-forwarded-for`, `x-real-ip`, and `x-client-ip` are excluded because they carry address data, not
 * credentials. Generic names such as `auth`, `bearer`, and `basic` are also excluded: as request
 * header names they are too ambiguous to justify blocking an export, while `spec.auth` is checked
 * separately.
 *
 * `set-cookie` is likewise absent: this list is applied to REQUEST headers only (every `redactSpec`
 * caller passes `spec.headers`), so adding it would be dead weight pretending to be coverage.
 *
 * Anti-CSRF tokens are in. They are not passwords, but they are session-bound and replayable, and a
 * request exported to git or expanded into model-facing text is exactly where a replayable token
 * should not be.
 */
export const CREDENTIAL_HEADERS: readonly string[] = [
  // Defined as credentials by the HTTP specs.
  'authorization',
  'proxy-authorization',
  'cookie',
  // Credentials by established API convention — the name states what the value is.
  'x-api-key',
  'api-key',
  'apikey',
  'x-auth-token',
  'x-access-token',
  'x-refresh-token',
  'x-amz-security-token',
  'x-goog-api-key',
  'private-token',
  // Session-bound, replayable.
  'x-csrf-token',
  'x-xsrf-token',
]

/**
 * Query parameters whose NAME says the value is a credential.
 *
 * The same argument as `CREDENTIAL_HEADERS`, applied to the other half of a request line. A credential
 * in the query string is not exotic: it is what `?api_key=…` is, and RFC 6750 §2.3 defines
 * `access_token` as a URI query parameter (while deprecating it) — so these are conventions with
 * standards behind them, not guesses.
 *
 * `key` is deliberately ABSENT even though Google's APIs use `?key=<API_KEY>`. Unlike `api_key`, a bare
 * `key` is an ordinary parameter name — a cache key, a sort key, a lookup key — and the line here is
 * drawn at ambiguity, exactly as it is for `X-Trace` in the header list. Same for `sig`, which is as
 * often a shortening of "significant" as of "signature".
 */
export const CREDENTIAL_QUERY_PARAMS: readonly string[] = [
  'api_key',
  'apikey',
  'api-key',
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'signature',
  'auth',
]

const isCredentialParamName = (name: string): boolean =>
  CREDENTIAL_QUERY_PARAMS.includes(name.trim().toLowerCase())

/** The credential-bearing query pairs actually present in `query`, by their own spelling. */
export function credentialQueryPairs(query: readonly Pair[] | undefined): Pair[] {
  return (query ?? []).filter((q) => isCredentialParamName(q.name) && q.value.trim() !== '')
}

/**
 * The credential-named parameters carried INLINE in a url string, as `name=value` pairs.
 *
 * Deliberately regex over the query portion instead of `new URL()`: a stored url is a TEMPLATE — it can
 * hold `:name` path placeholders and `${secret:KEY}` tokens, and it is not required to be absolute, so
 * `new URL` throws on inputs this has to handle.
 */
export function credentialUrlParams(url: string): { name: string; value: string }[] {
  const q = url.indexOf('?')
  if (q === -1) return []
  const found: { name: string; value: string }[] = []
  for (const part of url.slice(q + 1).split(/[&;]/)) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const name = part.slice(0, eq)
    const value = part.slice(eq + 1)
    if (isCredentialParamName(name) && value.trim() !== '') found.push({ name, value })
  }
  return found
}

/** Replace every credential-named parameter value in a url string with `replacement`. */
export function redactUrlCredentials(url: string, replacement: string): string {
  const q = url.indexOf('?')
  if (q === -1) return url
  const head = url.slice(0, q + 1)
  const rebuilt = url
    .slice(q + 1)
    .split(/([&;])/)
    .map((part) => {
      if (part === '&' || part === ';') return part
      const eq = part.indexOf('=')
      if (eq <= 0) return part
      const name = part.slice(0, eq)
      const value = part.slice(eq + 1)
      if (!isCredentialParamName(name) || value.trim() === '') return part
      return `${name}=${replacement}`
    })
    .join('')
  return head + rebuilt
}

/** The credential-bearing headers actually present in `headers`, by their own spelling. */
export function credentialHeaders(headers: readonly Pair[] | undefined): Pair[] {
  return (headers ?? []).filter(
    (h) => CREDENTIAL_HEADERS.includes(h.name.trim().toLowerCase()) && h.value.trim() !== '',
  )
}

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

/** True when `raw` parses as an http(s) URL. Other schemes are not ours to send. */
export function isHttpUrl(raw: string): boolean {
  try {
    const { protocol } = new URL(raw)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

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
 * A HOST written without a scheme: `api.dev/x`, `localhost:3000/api`, `127.0.0.1:8080`.
 *
 * A scheme is only accepted here when the author wrote `://`. `URL` does not enforce that boundary:
 * `new URL('localhost:3000/api')` parses successfully, treats `localhost:` as the scheme, and puts
 * the port in the path. Nothing throws, so every downstream check would reason about a URL the user
 * never wrote.
 *
 * The host-shaped check keeps real schemes out: `file:/etc/passwd` has no `://` either, and it must
 * not be excused as a typo.
 */
const SCHEMELESS_HOST =
  /^(?:localhost|\[[0-9a-f:]+\]|[a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?(?:[/?#]|$)/i

/**
 * A url problem: what to tell the person, AND what kind of problem it is.
 *
 * The code travels WITH the message rather than being recovered from it downstream. `errors.ts`
 * used to re-derive exactly this by regex, and every message that failed to match its patterns
 * silently became a `502 network_error` — "the upstream is broken" — for a url we never sent.
 */
export interface UrlProblem {
  code: SendErrorCode
  message: string
}

/**
 * Why `raw` cannot be sent, in words a person can act on — or null when it is a fine http(s) url.
 *
 * This exists because the two commonest wrong urls both produced an answer that was useless or
 * actively misleading:
 *
 *   `localhost:3000/api`  → 'Refusing to send to "localhost://…" — this client speaks http(s)
 *                           only. A localhost: url can read local files, and no setting enables
 *                           it.'
 *   `api.github.com/user` → '"api.github.com/user" cannot be parsed as a URL.'
 *
 * The first accuses someone of attempting an LFI for typing the most ordinary url in local
 * development, and never mentions the actual problem. The second is Bun's raw TypeError leaking
 * out of `new URL` — not our sentence at all, and it says nothing about what to do.
 *
 * WE DO NOT DEFAULT THE SCHEME. Doing so here would silently rewrite the request inside the send
 * path, and choosing `http:` could expose `${secret:KEY}` credentials resolved from the vault at
 * send time. Refusing costs a round trip; guessing wrong costs the credential.
 */
export function urlProblem(raw: string): UrlProblem | null {
  const url = raw.trim()
  if (url === '') return { code: 'bad_request', message: 'The url is empty.' }
  if (isHttpUrl(url)) return null

  if (!url.includes('://') && SCHEMELESS_HOST.test(url)) {
    return {
      code: 'bad_request',
      message:
        `"${url}" has no scheme, so there is nothing to send it over. Write it in full — ` +
        `"https://${url}" (or "http://${url}" if the server really does not do TLS). ` +
        'The scheme is not guessed for you: this client resolves ${secret:KEY} credentials at send ' +
        'time, and picking http:// on your behalf would put them on the wire in plaintext.',
    }
  }

  let protocol: string
  try {
    protocol = new URL(url).protocol
  } catch {
    return {
      code: 'bad_request',
      message: `"${url}" is not a url this client can parse. It needs to look like "https://host/path".`,
    }
  }
  // `blocked`, not `bad_request`: `file:///etc/passwd` is a perfectly well-formed url and we are
  // REFUSING it. The distinction is the one errors.ts already draws — a 403 says "we won't", a 400
  // says "you can't write that" — and the UI must not offer a retry for the first.
  return {
    code: 'blocked',
    message:
      `Refusing to send to a "${protocol}" url — this client speaks http(s) only. ` +
      'A file:, data: or similar url can read local resources, and no setting enables it.',
  }
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
