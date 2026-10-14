import { describe, expect, test } from 'bun:test'

import {
  attachProviderResponse,
  MAX_TRUSTED_RETRY_DELAY_MS,
  providerResponseOf,
  providerRetryDelayMs,
} from './provider-http-error'

const NOW = Date.parse('2026-07-26T12:00:00Z')

const withHeaders = (headers: Record<string, string>, status = 429) =>
  attachProviderResponse(new Error('rate limited'), { status, headers })

/**
 * How long the provider said to wait, read off the response it refused with.
 *
 * This is untrusted numeric input from the network: reject malformed, negative, and non-finite
 * values, and clamp well-formed extreme delays to one hour. Read `retry-after-ms` before
 * `retry-after` for precision, and floor elapsed absolute times at zero so clock skew preserves
 * an explicit instruction to retry now.
 */
describe('providerRetryDelayMs — header forms', () => {
  test('retry-after-ms wins, being the precise millisecond extension', () => {
    // Both provider SDKs send it, and it is more precise than the integer seconds header;
    // pi's own codex transport reads it first for the same reason.
    expect(providerRetryDelayMs(withHeaders({ 'retry-after-ms': '1500' }), NOW)).toBe(1500)
    expect(
      providerRetryDelayMs(withHeaders({ 'retry-after-ms': '1500', 'retry-after': '60' }), NOW),
    ).toBe(1500)
  })

  test('retry-after as delta-seconds (RFC 9110)', () => {
    expect(providerRetryDelayMs(withHeaders({ 'retry-after': '25' }), NOW)).toBe(25_000)
  })

  test('retry-after as an HTTP-date', () => {
    expect(
      providerRetryDelayMs(withHeaders({ 'retry-after': 'Sun, 26 Jul 2026 12:02:00 GMT' }), NOW),
    ).toBe(120_000)
  })

  test('a date already in the past means "retry now", not "no hint"', () => {
    // Clock skew plus network latency routinely produce one. Dropping it would fall back to a
    // longer invented wait against an explicit server instruction, so it floors to zero.
    expect(
      providerRetryDelayMs(withHeaders({ 'retry-after': 'Sun, 26 Jul 2026 11:59:00 GMT' }), NOW),
    ).toBe(0)
  })

  test("anthropic's RFC 3339 reset headers, most restrictive wins", () => {
    // Documented shape: `anthropic-ratelimit-{requests,tokens,…}-reset` as RFC 3339. The
    // header set reflects the most restrictive limit in effect, so the LATEST reset is the one
    // that actually gates the next request.
    const delay = providerRetryDelayMs(
      withHeaders({
        'anthropic-ratelimit-requests-reset': '2026-07-26T12:01:00Z',
        'anthropic-ratelimit-tokens-reset': '2026-07-26T12:07:00Z',
      }),
      NOW,
    )
    expect(delay).toBe(7 * 60_000)
  })

  test("openai's reset headers are Go durations, not timestamps", () => {
    expect(providerRetryDelayMs(withHeaders({ 'x-ratelimit-reset-tokens': '6m0s' }), NOW)).toBe(
      6 * 60_000,
    )
    expect(providerRetryDelayMs(withHeaders({ 'x-ratelimit-reset-requests': '1s' }), NOW)).toBe(
      1000,
    )
    // Compound durations add up …
    expect(providerRetryDelayMs(withHeaders({ 'x-ratelimit-reset-tokens': '45m30s' }), NOW)).toBe(
      45 * 60_000 + 30_000,
    )
    // … and are still subject to the trusted ceiling: 1h30m is longer than any window we
    // believe, so it lands on the ceiling rather than being honored at 90m.
    expect(providerRetryDelayMs(withHeaders({ 'x-ratelimit-reset-tokens': '1h30m' }), NOW)).toBe(
      MAX_TRUSTED_RETRY_DELAY_MS,
    )
  })

  test('a BARE NUMBER reset is a delta or an epoch, never a date', () => {
    // The trap this locks down: `Date.parse('5')` is the year 2001 and `Date.parse('2026')` is a
    // real date, so resolving a bare number as a date first makes every such header land in the
    // past and silently mean "retry now" — the window is thrown away while looking handled.
    // Several gateways send exactly this, either as delta-seconds or as a Unix epoch.
    expect(providerRetryDelayMs(withHeaders({ 'x-ratelimit-reset-requests': '45' }), NOW)).toBe(
      45_000,
    )
    expect(providerRetryDelayMs(withHeaders({ 'x-ratelimit-reset-requests': '2026' }), NOW)).toBe(
      2_026_000,
    )
    // An epoch in seconds resolves against `now`, not as a duration.
    const epochIn10Min = String(Math.round(NOW / 1000) + 600)
    expect(
      providerRetryDelayMs(withHeaders({ 'x-ratelimit-reset-requests': epochIn10Min }), NOW),
    ).toBe(600_000)
    // And an epoch already past is "retry now", the same as a past date.
    const epochPast = String(Math.round(NOW / 1000) - 600)
    expect(
      providerRetryDelayMs(withHeaders({ 'x-ratelimit-reset-requests': epochPast }), NOW),
    ).toBe(0)
  })

  test('an epoch in MILLISECONDS is a third range, not an absurd number of seconds', () => {
    // The defect a review caught: `>= 1e9` alone read an epoch-ms value as ~1e9 SECONDS in the
    // future, which the ceiling then turned into a full HOUR of cooldown — the maximum wrong
    // answer, and one the cooldown never clears on a later success. Silencing a session's
    // scheduled loops for an hour is the concrete cost.
    const epochMsIn10Min = String(NOW + 600_000)
    expect(
      providerRetryDelayMs(withHeaders({ 'x-ratelimit-reset-tokens': epochMsIn10Min }), NOW),
    ).toBe(600_000)
    // And it must NOT be mistaken for the ceiling any more.
    expect(
      providerRetryDelayMs(withHeaders({ 'x-ratelimit-reset-tokens': epochMsIn10Min }), NOW),
    ).not.toBe(MAX_TRUSTED_RETRY_DELAY_MS)
    // A past epoch-ms is "retry now", like every other past instant.
    expect(
      providerRetryDelayMs(withHeaders({ 'x-ratelimit-reset-tokens': String(NOW - 1000) }), NOW),
    ).toBe(0)
  })

  test('retry-after with a unit suffix is read rather than discarded', () => {
    // Not in the RFC, but sent in the wild. Falling back to the invented floor for `30s` is a
    // worse answer than reading it.
    expect(providerRetryDelayMs(withHeaders({ 'retry-after': '30s' }), NOW)).toBe(30_000)
  })

  test('an explicit retry-after outranks an advisory reset', () => {
    // `retry-after` is an instruction; `*-reset` describes when a window replenishes. When
    // both are present the instruction is the one to obey.
    const delay = providerRetryDelayMs(
      withHeaders({
        'retry-after': '30',
        'anthropic-ratelimit-tokens-reset': '2026-07-26T12:40:00Z',
      }),
      NOW,
    )
    expect(delay).toBe(30_000)
  })

  test('header names are matched case-insensitively', () => {
    expect(providerRetryDelayMs(withHeaders({ 'Retry-After': '10' }), NOW)).toBe(10_000)
  })
})

describe('providerRetryDelayMs — hostile input', () => {
  test('garbage, empty and non-finite values yield no hint at all', () => {
    for (const value of ['', '   ', 'soon', 'NaN', 'Infinity', '-Infinity']) {
      expect({
        value,
        delay: providerRetryDelayMs(withHeaders({ 'retry-after': value }), NOW),
      }).toEqual({ value, delay: undefined })
    }
  })

  test('a negative NUMBER is malformed, while a past DATE is "retry now"', () => {
    // The two cases are genuinely different. A negative delta-seconds is not something
    // a server can mean, so it is malformed input → no hint. A past instant IS something a
    // server produces (clock skew, latency), and there it means retry now.
    expect(providerRetryDelayMs(withHeaders({ 'retry-after': '-30' }), NOW)).toBeUndefined()
    expect(providerRetryDelayMs(withHeaders({ 'retry-after-ms': '-1' }), NOW)).toBeUndefined()
    expect(
      providerRetryDelayMs(withHeaders({ 'retry-after': 'Sun, 26 Jul 2026 11:00:00 GMT' }), NOW),
    ).toBe(0)
  })

  test('a MALFORMED number degrades to no hint, not to a number', () => {
    // RFC 9110 delta-seconds is decimal digits. `Number()` alone also accepts `0x10` (16s) and
    // `1e30`, inventing values from malformed headers that must instead yield no retry hint.
    for (const value of ['1e30', '0x10', '1e3', '+30', ' 30 s']) {
      expect({
        value,
        delay: providerRetryDelayMs(withHeaders({ 'retry-after': value }), NOW),
      }).toEqual({ value, delay: undefined })
    }
  })

  test('a well-formed but absurd value is clamped to the trusted ceiling', () => {
    // The failure mode a ceiling prevents: a real-looking header becoming an unbounded
    // cooldown, and — in a language with a Duration type — a panic.
    expect(providerRetryDelayMs(withHeaders({ 'retry-after': '999999999' }), NOW)).toBe(
      MAX_TRUSTED_RETRY_DELAY_MS,
    )
    expect(
      providerRetryDelayMs(
        withHeaders({ 'anthropic-ratelimit-tokens-reset': '2099-01-01T00:00:00Z' }),
        NOW,
      ),
    ).toBe(MAX_TRUSTED_RETRY_DELAY_MS)
  })

  test('an error with no response and no stated delay yields undefined', () => {
    expect(providerRetryDelayMs(new Error('boom'), NOW)).toBeUndefined()
    expect(providerRetryDelayMs(undefined, NOW)).toBeUndefined()
    expect(providerRetryDelayMs('a string', NOW)).toBeUndefined()
  })
})

describe('providerRetryDelayMs — the delay stated in the message', () => {
  test('a codex usage cap states its reset in prose, with no header carrying it', () => {
    // pi renders the body's `resets_at` as this sentence and throws it as the message
    // (`openai-codex-responses.ts`); codex itself likewise regexes its retry delay out of the
    // error text. Same signal, read the same way.
    expect(
      providerRetryDelayMs(
        new Error('You have hit your ChatGPT usage limit (plus plan). Try again in ~47 min.'),
        NOW,
      ),
    ).toBe(47 * 60_000)
    expect(providerRetryDelayMs(new Error('Rate limited. Try again in 30 seconds'), NOW)).toBe(
      30_000,
    )
    expect(providerRetryDelayMs(new Error('retry in 250ms'), NOW)).toBe(250)
  })

  test('a header always outranks prose', () => {
    const error = attachProviderResponse(new Error('Try again in ~47 min.'), {
      status: 429,
      headers: { 'retry-after': '20' },
    })
    expect(providerRetryDelayMs(error, NOW)).toBe(20_000)
  })

  test('the prose channel can be switched off by failure class', () => {
    // A plain transient message ("Service unavailable, try again in 30 minutes") is not an
    // instruction about an allowance, so the classifier only mines prose for a rate limit.
    const transient = new Error('Service unavailable, please try again in 30 minutes')
    expect(providerRetryDelayMs(transient, NOW)).toBe(30 * 60_000)
    expect(providerRetryDelayMs(transient, NOW, { fromMessage: false })).toBeUndefined()
  })

  test('prose without a duration is not mined for numbers', () => {
    expect(providerRetryDelayMs(new Error('429 Too Many Requests'), NOW)).toBeUndefined()
    expect(providerRetryDelayMs(new Error('try again later'), NOW)).toBeUndefined()
  })
})

describe('providerResponseOf — the shapes that really occur', () => {
  test('reads what the runtime adapter attached, lowercasing header names', () => {
    const error = attachProviderResponse(new Error('x'), {
      status: 429,
      headers: { 'Retry-After': '5' },
    })
    expect(providerResponseOf(error)).toEqual({ status: 429, headers: { 'retry-after': '5' } })
  })

  test('the attachment is invisible to enumeration and serialization', () => {
    // It rides on errors that cross package boundaries and land in logs; provider headers must
    // not start appearing in `JSON.stringify(error)` or spread copies.
    const error = attachProviderResponse(new Error('x'), { status: 429, headers: { a: 'b' } })
    expect(Object.keys(error)).toEqual([])
    expect(JSON.stringify(error)).toBe('{}')
  })

  test('reads the official SDK shape: status and headers ON the error', () => {
    // @anthropic-ai/sdk and openai both expose `APIError.headers: Headers` with NO `response`
    // field — a probe that only looked at `error.response.headers` matched neither.
    const error = Object.assign(new Error('429 rate limit'), {
      status: 429,
      headers: new Headers({ 'retry-after': '12' }),
    })
    expect(providerResponseOf(error)).toEqual({ status: 429, headers: { 'retry-after': '12' } })
    expect(providerRetryDelayMs(error, NOW)).toBe(12_000)
  })

  test('reads a fetch-style error.response as well', () => {
    const error = Object.assign(new Error('429'), {
      response: { status: 429, headers: new Headers({ 'retry-after': '3' }) },
    })
    expect(providerRetryDelayMs(error, NOW)).toBe(3000)
  })

  test('an unrelated `headers` property does not fabricate a response', () => {
    expect(providerResponseOf(Object.assign(new Error('x'), { headers: {} }))).toBeUndefined()
    expect(providerResponseOf(Object.assign(new Error('x'), { headers: 'nope' }))).toBeUndefined()
    // The case the previous version of this test MISSED, and which was a real defect: an error
    // carrying unrelated request headers alongside a genuine `response`. The `headers` probe
    // returned first with a non-empty record, so the real `Retry-After` was discarded — the
    // test asserted coverage it did not have.
    const shadowed = Object.assign(new Error('429 rate limit'), {
      headers: { 'content-type': 'application/json' },
      response: { status: 429, headers: new Headers({ 'retry-after': '30' }) },
    })
    expect(providerResponseOf(shadowed)).toEqual({
      status: 429,
      headers: { 'retry-after': '30' },
    })
    expect(providerRetryDelayMs(shadowed, NOW)).toBe(30_000)
  })

  test('the status always describes the response the headers came from', () => {
    // Reporting `status: 0` next to a 429's headers is a footgun for the next consumer even
    // while nothing reads it: the two halves must not describe different responses.
    const error = Object.assign(new Error('x'), {
      status: 500,
      response: { status: 429, headers: new Headers({ 'retry-after': '5' }) },
    })
    expect(providerResponseOf(error)).toEqual({ status: 429, headers: { 'retry-after': '5' } })
  })
})
