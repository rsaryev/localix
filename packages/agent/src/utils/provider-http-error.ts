/**
 * THE provider-HTTP error: its NAME, and the MESSAGE SHAPE the status is read back out of.
 *
 * Both are bare strings, and both are load-bearing contracts with `classifyAgentError`:
 *
 *   1. NAME. The classifier branches on `error.name === 'FetchError'` — and that branch is
 *      where a 429 becomes retryable, a 5xx warrants provider failover, and a 400/413 that
 *      names the context window becomes `shouldCompress` (send less history and retry) instead
 *      of a dead end. An error that misses the branch by one character is a plain `fatal`:
 *      the turn dies where it would have recovered.
 *
 *   2. MESSAGE SHAPE. `extractProviderStatus` scrapes the status back out with a
 *      `\b[1-5]\d{2}\b` regex because runtime adapters can expose HTTP-like failures
 *      without leaking their concrete transport classes into the host. The structural
 *      `"<provider> <status>: <body>"` shape is the adapter-neutral boundary.
 */

/**
 * The `name` every provider-HTTP error carries — the string, and the ONLY string,
 * `classifyAgentError` recognizes a provider rejection by.
 *
 * Historical, and deliberately kept: renaming it is a silent, repo-wide behavior change
 * (every provider rejection would fall through to non-retryable `fatal`), so the name is
 * cheap to keep and expensive to "clean up".
 */
export const PROVIDER_HTTP_ERROR_NAME = 'FetchError'

/**
 * True when `error` is a provider-HTTP rejection — i.e. the thing the classifier's status
 * branch is for. Matched by NAME rather than by class because adapter errors cross a package
 * boundary where a shared concrete class and `instanceof` cannot be relied on.
 */
export function isProviderHttpError(error: unknown): error is Error {
  return error instanceof Error && error.name === PROVIDER_HTTP_ERROR_NAME
}

/**
 * The message shape `extractProviderStatus` parses: `"<provider>[ (<model>)][ <status>]: <body>"`.
 *
 * The status is embedded on purpose — it is how it reaches the classifier at all. A falsy
 * status (unknown, or a mid-stream error with no HTTP code) is omitted rather than printed
 * as `0`, so the scrape finds no status instead of a fake one.
 */
export function providerHttpErrorMessage(
  provider: string,
  status: number | undefined,
  body: string,
  model?: string,
): string {
  const label = `${provider}${model ? ` (${model})` : ''}${status ? ` ${status}` : ''}`
  return `${label}: ${body}`
}

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
const RATE_LIMIT_HEADER_NAMES = [
  'retry-after-ms',
  'retry-after',
  'anthropic-ratelimit-requests-reset',
  'anthropic-ratelimit-tokens-reset',
  'anthropic-ratelimit-input-tokens-reset',
  'anthropic-ratelimit-output-tokens-reset',
  'x-ratelimit-reset-requests',
  'x-ratelimit-reset-tokens',
] as const

/**
 * The longest server-stated delay that is honored, before it is treated as a malformed
 * header rather than a real window.
 *
 * A ceiling is required, not optional: a far-future date or a `1e30` seconds value would
 * otherwise become the cooldown: a malformed 429 must degrade to "no retry hint", not to an
 * unbounded wait. One hour is the ceiling.
 *
 * Note this is the ceiling on TRUSTING the hint. Each consumer still applies its own ceiling
 * for what it may WAIT — an in-request retry cannot sleep an hour, while a session-level
 * cooldown can. Conflating the two is a real defect: capping an honored `retry-after` at a
 * short in-request backoff ceiling turns a stated 60 s window into a guaranteed second 429.
 */
export const MAX_TRUSTED_RETRY_DELAY_MS = 60 * 60_000

/** `1s`, `6m0s`, `1h30m` — the Go duration form OpenAI uses for `x-ratelimit-reset-*`. */
function parseGoDurationMs(raw: string): number | undefined {
  const parts = raw
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?(?:ms|s|m|h))+$/)
  if (!parts) return undefined
  let total = 0
  for (const [, value, unit] of raw
    .trim()
    .toLowerCase()
    .matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) {
    const n = Number(value)
    if (!Number.isFinite(n)) return undefined
    total += n * (unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : 3_600_000)
  }
  return total
}

/** Digits only, optionally fractional — what a delta-seconds / millisecond header may be.
 *  `Number()` alone also accepts `0x10` (→ 16 s) and `1e3` (→ 1000 s); RFC 9110 delta-seconds
 *  is decimal digits, so anything else is a malformed header, not a clever encoding. */
const PLAIN_NUMBER_RE = /^\d+(?:\.\d+)?$/

function plainNumber(value: string): number | undefined {
  if (!PLAIN_NUMBER_RE.test(value)) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Interpret a bare number in a `*-reset` header. THREE ranges, not two:
 *
 *   >= 1e12  a Unix epoch in MILLISECONDS (2001-09-09 onward)
 *   >= 1e9   a Unix epoch in SECONDS (same instant, /1000)
 *   else     delta-seconds
 *
 * The middle range used to swallow the first, and the failure was the worst available one: an
 * epoch-ms value became ~1e9 seconds in the future, which the trusted-hint ceiling then turned
 * into a FULL HOUR of cooldown — and the cooldown is never cleared by a later success, so one
 * such header silenced every scheduled firing of that session for an hour. Found by review.
 *
 * The remaining ambiguity (a delta of 1e9 seconds ≈ 31 years) is not a real encoding, so the
 * ranges cannot collide on any value a provider actually sends.
 */
function resetFromNumber(numeric: number, now: number): number {
  if (numeric >= 1e12) return Math.max(0, numeric - now)
  if (numeric >= 1e9) return Math.max(0, numeric * 1000 - now)
  return Math.max(0, numeric * 1000)
}

function delayFromHeader(name: string, raw: string, now: number): number | undefined {
  const value = raw.trim()
  if (!value) return undefined
  if (name === 'retry-after-ms') {
    const ms = plainNumber(value)
    return ms === undefined ? undefined : Math.max(0, ms)
  }
  if (name === 'retry-after') {
    const seconds = plainNumber(value)
    if (seconds !== undefined) return Math.max(0, seconds * 1000)
    // Not in the RFC, but sent in the wild: a duration with a unit suffix (`30s`). Cheaper to
    // read than to force onto the invented floor.
    const duration = parseGoDurationMs(value)
    if (duration !== undefined) return duration
    const at = Date.parse(value)
    // A date already in the past means "retry now", NOT "no hint" — clock skew plus network
    // latency routinely produce one, and discarding it would fall back to a longer invented
    // wait against an explicit server instruction.
    return Number.isFinite(at) ? Math.max(0, at - now) : undefined
  }
  // A `*-reset`: an RFC 3339 instant (Anthropic), a duration (OpenAI), or a bare number
  // (several gateways). The bare number MUST be resolved before `Date.parse`, which happily
  // reads "5" as the year 2001 and "2026" as a date — both would then land in the past and
  // silently mean "retry now", throwing the window away.
  const numeric = plainNumber(value)
  if (numeric !== undefined) return resetFromNumber(numeric, now)
  const duration = parseGoDurationMs(value)
  if (duration !== undefined) return duration
  const at = Date.parse(value)
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined
}

/**
 * How long the provider itself said to wait, in ms — or undefined when it said nothing
 * usable, which is the signal for the caller to fall back to its own backoff.
 *
 * Header values are untrusted numeric input from the network: a malformed value degrades to NO
 * HINT rather than to a number, a well-formed but absurd one is clamped to
 * `MAX_TRUSTED_RETRY_DELAY_MS`, and negatives floor at 0. `0` is a MEANINGFUL answer ("retry
 * now") and is deliberately distinguishable from undefined — callers must not `||` it away.
 *
 * `fromMessage` controls the prose fallback (see `retryDelayFromMessage`). It defaults on for
 * direct callers, but the classifier passes the failure class: prose is a rate-limit channel,
 * not a general one.
 */
export function providerRetryDelayMs(
  error: unknown,
  now = Date.now(),
  options?: { fromMessage?: boolean },
): number | undefined {
  const prose = () => (options?.fromMessage === false ? undefined : retryDelayFromMessage(error))
  const response = providerResponseOf(error)
  if (!response) return prose()
  let best: number | undefined
  for (const name of RATE_LIMIT_HEADER_NAMES) {
    const raw = response.headers[name]
    if (raw === undefined) continue
    const delay = delayFromHeader(name, raw, now)
    if (delay === undefined || !Number.isFinite(delay) || delay < 0) continue
    // `retry-after-ms` / `retry-after` are explicit instructions: the first one present wins
    // outright. The `*-reset` family is advisory, and the most restrictive (latest) one is
    // the one that actually gates the next request.
    if (name === 'retry-after-ms' || name === 'retry-after') {
      return Math.min(delay, MAX_TRUSTED_RETRY_DELAY_MS)
    }
    best = best === undefined ? delay : Math.max(best, delay)
  }
  if (best !== undefined) return Math.min(best, MAX_TRUSTED_RETRY_DELAY_MS)
  return prose()
}

/**
 * Some providers put the window in the BODY, and by the time an error reaches us the body is
 * only a sentence. The one that matters here is the ChatGPT/codex usage cap: pi renders
 * `error.resets_at` as "Try again in ~47 min." and throws that as the message
 * (`vendor/pi/packages/ai/src/api/openai-codex-responses.ts`), with no header carrying the
 * same number. A regex over the error text (`try again in N s|ms`) is therefore the only place
 * that delay can be read from.
 *
 * Only ever a fallback: a real header always wins, because text is the least reliable
 * encoding of a number the network can hand us.
 */
function retryDelayFromMessage(error: unknown): number | undefined {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (!message) return undefined
  const match =
    /(?:try again|retry) in\s*~?\s*(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|seconds?|m|min|mins|minutes?|h|hours?)\b/i.exec(
      message,
    )
  if (!match) return undefined
  const value = Number(match[1])
  if (!Number.isFinite(value) || value < 0) return undefined
  const unit = match[2]!.toLowerCase()
  const ms = unit.startsWith('ms')
    ? value
    : unit.startsWith('h')
      ? value * 3_600_000
      : unit.startsWith('m') && !unit.startsWith('ms')
        ? value * 60_000
        : value * 1000
  return Math.min(ms, MAX_TRUSTED_RETRY_DELAY_MS)
}
