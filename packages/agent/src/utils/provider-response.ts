/**
 * The provider HTTP response an error came out of — status plus the response headers.
 *
 * Why this exists at all: the classifier's rate-limit timing (`retryAfterMs`) is read off the
 * response, and a runtime adapter that flattens a provider failure into a plain `Error`
 * destroys it. `Retry-After` is then unrecoverable and every rate-limit cooldown falls back
 * to an invented constant, however precisely the server stated its window.
 *
 * Headers are lowercase-keyed on the way in, because HTTP header names are
 * case-insensitive and both accepted shapes below disagree about normalizing them.
 */
export interface ProviderResponseFacts {
  status: number
  headers: Record<string, string>
}

const PROVIDER_RESPONSE = Symbol.for('localix.providerResponse')

/**
 * Attach the response that produced `error`, for the classifier to read back.
 *
 * A Symbol key rather than a plain property: this rides on error objects that cross package
 * and (via structured logging) serialization boundaries, and it must never show up as
 * enumerable state on an Error — `JSON.stringify(error)`, spread copies and log redactors
 * would all start carrying provider headers around.
 */
export function attachProviderResponse<E extends Error>(
  error: E,
  response: ProviderResponseFacts,
): E {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(response.headers)) headers[key.toLowerCase()] = value
  Object.defineProperty(error, PROVIDER_RESPONSE, {
    value: { status: response.status, headers },
    enumerable: false,
    configurable: true,
  })
  return error
}

/**
 * Extract ONLY the rate-limit-relevant headers, from either a `Headers` instance or a plain
 * record. Narrow on purpose: the result decides whether a candidate object counts as "the
 * response", and a record of arbitrary headers would make any object with a `headers`
 * property qualify — which is how a real `error.response` gets shadowed by unrelated request
 * headers hanging off the same error.
 */
function rateLimitHeadersOf(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const headers: Record<string, string> = {}
  if (typeof (raw as { get?: unknown }).get === 'function') {
    // A `Headers` instance. `get` is the only accessor the shape is guaranteed to have
    // (iteration is not), so read the names we know rather than enumerating.
    const get = (raw as { get: (key: string) => string | null }).get.bind(raw)
    for (const name of RATE_LIMIT_HEADER_NAMES) {
      const value = get(name)
      if (value !== null && value !== undefined) headers[name] = value
    }
    return headers
  }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = key.toLowerCase()
    if (typeof value === 'string' && (RATE_LIMIT_HEADER_NAMES as readonly string[]).includes(name))
      headers[name] = value
  }
  return headers
}

/**
 * Read the provider response off an error, accepting the THREE shapes that really occur:
 *
 *   1. what `attachProviderResponse` stored (runtime adapters — the pi path);
 *   2. the official SDK shape: `status` + `headers` DIRECTLY on the error. Both
 *      `@anthropic-ai/sdk` and `openai` expose `APIError.headers: Headers` and
 *      `APIError.status` with no `response` field at all — checked against the installed
 *      versions, because an earlier probe here looked only for `error.response.headers` and
 *      therefore matched neither SDK even hypothetically;
 *   3. a fetch-style `error.response` with `status` + `headers`.
 *
 * Shapes 2 and 3 are BOTH considered, and the one that actually carries a rate-limit header
 * wins — an independent review found the earlier version returning as soon as `error.headers`
 * produced any entry at all, so an error carrying unrelated request headers next to a real
 * `error.response` (`{headers: {'content-type': …}, response: {status: 429, headers:
 * {'retry-after': '30'}}}`) reported no delay at all. Status is taken from whichever shape
 * supplied the headers, so it can never describe a different response than they do.
 *
 * Returns undefined when none is present, so callers stay on their invented fallback.
 */
export function providerResponseOf(error: unknown): ProviderResponseFacts | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const attached = (error as Record<symbol, unknown>)[PROVIDER_RESPONSE]
  if (attached && typeof attached === 'object') return attached as ProviderResponseFacts
  const own = error as { status?: unknown; headers?: unknown; response?: unknown }
  const ownHeaders = rateLimitHeadersOf(own.headers)
  if (ownHeaders && Object.keys(ownHeaders).length > 0) {
    return { status: typeof own.status === 'number' ? own.status : 0, headers: ownHeaders }
  }
  const response = own.response
  if (typeof response !== 'object' || response === null) return undefined
  const headers = rateLimitHeadersOf((response as { headers?: unknown }).headers)
  if (!headers) return undefined
  const status = (response as { status?: unknown }).status
  return { status: typeof status === 'number' ? status : 0, headers }
}

/**
 * Every header name a rate-limit delay can be read from, in the order they are trusted.
 *
 * `retry-after-ms` first: it is the millisecond extension both Anthropic's and OpenAI's SDKs
 * send, it is more precise than the integer `retry-after`, and pi's own codex transport reads
 * it first for that reason (`vendor/pi/packages/ai/src/api/openai-codex-responses.ts`).
 * Then `retry-after` (RFC 9110 §10.2.3 — delta-seconds or an HTTP-date).
 *
 * The `*-reset` headers are the fallback for a provider that reports WHEN the window
 * replenishes instead of how long to wait. Anthropic documents these as RFC 3339 timestamps
 * (`anthropic-ratelimit-{requests,tokens,input-tokens,output-tokens}-reset`, and a 429 body
 * carries `retry-after` alongside them); OpenAI's `x-ratelimit-reset-*` are duration strings
 * (`1s`, `6m0s`) — both forms are parsed. The most restrictive limit wins, so the LATEST
 * reset among those present is the one honored.
 */
export const RATE_LIMIT_HEADER_NAMES = [
  'retry-after-ms',
  'retry-after',
  'anthropic-ratelimit-requests-reset',
  'anthropic-ratelimit-tokens-reset',
  'anthropic-ratelimit-input-tokens-reset',
  'anthropic-ratelimit-output-tokens-reset',
  'x-ratelimit-reset-requests',
  'x-ratelimit-reset-tokens',
] as const
