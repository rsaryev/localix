import { providerResponseOf, RATE_LIMIT_HEADER_NAMES } from './provider-response'

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
