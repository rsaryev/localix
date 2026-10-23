import type { Pair } from './request-spec'

/**
 * Headers that ARE credentials, by definition rather than by guess.
 *
 * The distinction this list exists to make: "is `X-Trace: abc123` a secret?" is a guess, and a
 * guess that says yes blocks real work while one that says no lends false confidence. But
 * `Authorization` and `Cookie` are not guesses — the HTTP specs define them as credentials, and
 * nothing else legitimately lives there.
 *
 * That distinction was WRONG for fourteen iterations. `gitSafetyProblem` and `redactAuth` both
 * reasoned about `spec.auth` only, defended by "auth is the one place this mini app promises to
 * hold credentials" — while `import/har.ts` and `import/curl.ts` deliberately route credentials
 * into HEADERS instead (a HAR keeps its `Authorization` verbatim and folds cookies into one; curl
 * keeps an auth scheme it cannot sign, e.g. GitHub's own `Authorization: Token …`). Each module's
 * comment was true of itself; none was true of the composition.
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
