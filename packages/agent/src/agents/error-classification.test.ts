import { describe, expect, test } from 'bun:test'
import { attachProviderResponse } from '../utils/provider-http-error'
import { classifyAgentError, extractProviderStatus, coerceToolResult } from './error-classification'
import { AgentRunError } from './errors'
import { HumanInLoopDismissedError, HumanInLoopTimeoutError } from './human-in-loop'

/** An RFC 3339 instant `ms` in the future — reset headers are absolute, not durations. */
const futureIso = (ms: number) => new Date(Date.now() + ms).toISOString()

const named = (name: string, message: string) => {
  const e = new Error(message)
  e.name = name
  return e
}

describe('classifyAgentError', () => {
  test('an unavailable agent is terminal even when its handle resembles a transient error', () => {
    const message = 'Agent is no longer in the session: timeout'
    expect(classifyAgentError(new AgentRunError('AGENT_UNAVAILABLE', message))).toEqual({
      kind: 'fatal',
      userMessage: message,
      retryable: false,
    })
  })
  test('abort + HITL errors', () => {
    expect(classifyAgentError(named('AbortError', 'x'))).toMatchObject({
      kind: 'abort',
      retryable: false,
    })
    // RetryAbortError is the OR-sibling of AbortError — also a non-retryable abort.
    expect(classifyAgentError(named('RetryAbortError', 'x'))).toMatchObject({
      kind: 'abort',
      retryable: false,
    })
    expect(classifyAgentError(new HumanInLoopDismissedError())).toMatchObject({
      kind: 'dismissed',
      retryable: true,
    })
    expect(classifyAgentError(new HumanInLoopTimeoutError())).toMatchObject({
      kind: 'timeout',
      retryable: true,
    })
  })

  test('name-matched provider timeouts (retryable, but different kinds)', () => {
    // Provider took too long to respond at all.
    expect(classifyAgentError(named('TimeoutError', 'x'))).toMatchObject({
      kind: 'fatal',
      retryable: true,
    })
    // Provider streamed then stalled mid-response — distinct 'timeout' kind.
    expect(classifyAgentError(named('StreamIdleTimeoutError', 'x'))).toMatchObject({
      kind: 'timeout',
      retryable: true,
    })
  })

  test('a model that cannot be bound says which step failed, typed and in its own words', () => {
    // Three failures used to read as one generic "No provider connection selected".
    const vanished = new AgentRunError(
      'NO_PROVIDER_CONNECTION',
      'Model "x/gone" is no longer available. Choose another model.',
      { reason: 'model_not_in_catalog' },
    )
    expect(classifyAgentError(vanished)).toEqual({
      kind: 'fatal',
      userMessage: 'Model "x/gone" is no longer available. Choose another model.',
      retryable: false,
      modelUnavailable: 'model_not_in_catalog',
    })
    // A throw that does not know the step keeps the generic sentence and claims no reason.
    const unknown = classifyAgentError(new AgentRunError('NO_PROVIDER_CONNECTION', 'raw'))
    expect(unknown.modelUnavailable).toBeUndefined()
    expect(unknown.userMessage).toMatch(/No provider connection selected/)
  })

  test('AgentRunError codes map to retryability', () => {
    expect(classifyAgentError(new AgentRunError('PROVIDER_AUTH_FAILED', 'm')).retryable).toBe(false)
    expect(classifyAgentError(new AgentRunError('PROVIDER_RATE_LIMITED', 'm')).retryable).toBe(true)
    expect(classifyAgentError(new AgentRunError('PROVIDER_UNAVAILABLE', 'm')).retryable).toBe(true)
  })

  test('a 400 context-overflow FetchError flags compaction, not retry', () => {
    const info = classifyAgentError(
      named('FetchError', 'provider 400: maximum context length exceeded'),
    )
    expect(info).toMatchObject({ kind: 'context_overflow', retryable: false, shouldCompress: true })
  })

  test('transient FetchErrors (429/5xx/408) are retryable + warrant fallback; 401 is fatal', () => {
    const rate = classifyAgentError(named('FetchError', 'provider 429: slow down'))
    expect(rate).toMatchObject({ retryable: true })
    const server = classifyAgentError(named('FetchError', 'provider 503: overloaded'))
    expect(server).toMatchObject({ retryable: true })
    const auth = classifyAgentError(named('FetchError', 'provider 401: bad key'))
    expect(auth).toMatchObject({ retryable: false })
  })

  test('the 5xx band starts AT 500, and 499 is not in it', () => {
    // The test above says "5xx" and asserts 503 — which is true of `>= 500` and equally true
    // of `> 500`. 500 is the canonical retryable server fault and the boundary the code
    // actually writes down, so it is the one that has to be asserted.
    expect(classifyAgentError(named('FetchError', 'provider 500: internal error')).retryable).toBe(
      true,
    )
    expect(classifyAgentError(named('FetchError', 'provider 499: client closed')).retryable).toBe(
      false,
    )
  })

  test('parses Retry-After (delta-seconds) off a 429 response into retryAfterMs', () => {
    const err = named('FetchError', 'provider 429: slow down') as Error & { response?: unknown }
    err.response = {
      headers: { get: (k: string) => (k.toLowerCase() === 'retry-after' ? '3' : null) },
    }
    expect(classifyAgentError(err).retryAfterMs).toBe(3000)
  })

  test('a 429 with no Retry-After header has undefined retryAfterMs (falls back to backoff)', () => {
    expect(
      classifyAgentError(named('FetchError', 'provider 429: slow down')).retryAfterMs,
    ).toBeUndefined()
  })

  test('a rate limit that arrives FLATTENED still gets the window off its response', () => {
    // The reachability defect this closes. `retryAfterMs` used to be set inside the
    // `FetchError` branch only, and in production nothing mints that name: every provider
    // failure reaches the classifier as a bare `Error` re-minted from a message string
    // (the runtime flattened the terminal assistant). So the
    // cooldown was ALWAYS an invented constant, however precisely the server had stated its
    // window. The runtime adapter now re-attaches the refusal, and the delay is read once for
    // every branch rather than in the one branch that never runs.
    const flattened = attachProviderResponse(new Error('Rate limit exceeded'), {
      status: 429,
      headers: { 'retry-after': '900' },
    })
    expect(flattened.name).toBe('Error') // i.e. NOT the FetchError branch
    expect(classifyAgentError(flattened).retryAfterMs).toBe(900_000)
  })

  test('a terminal quota cap also reports the window it stated', () => {
    // A plan cap is not retryable, but its reset time is the one number worth more than any
    // constant a cooldown could pick.
    const capped = attachProviderResponse(
      new Error('You have hit your usage limit for this plan.'),
      { status: 429, headers: { 'anthropic-ratelimit-tokens-reset': futureIso(35 * 60_000) } },
    )
    const info = classifyAgentError(capped)
    expect(info).toMatchObject({ retryable: false, rateLimited: true })
    // Rounded: the reset is computed against a live clock.
    expect(Math.round((info.retryAfterMs ?? 0) / 60_000)).toBe(35)
  })

  test('a non-rate-limit, non-retryable error is NOT given a delay', () => {
    // The enrichment is gated on the failure class, so a plain fatal never acquires a
    // meaningless "wait this long" from a response that happened to carry reset headers.
    const fatal = attachProviderResponse(new Error('Model not found'), {
      status: 404,
      headers: { 'anthropic-ratelimit-tokens-reset': futureIso(60_000) },
    })
    expect(classifyAgentError(fatal).retryAfterMs).toBeUndefined()
  })

  test('a quota/billing cap is NOT retried even on a 429 (OpenAI insufficient_quota shape)', () => {
    const info = classifyAgentError(
      named(
        'FetchError',
        'provider 429: You exceeded your current quota, please check your plan and billing details.',
      ),
    )
    expect(info).toMatchObject({ kind: 'fatal', retryable: false, rateLimited: true })
  })

  test('authFailed flags a refused credential, and nothing else', () => {
    expect(classifyAgentError(named('FetchError', 'provider 401: bad key')).authFailed).toBe(true)
    expect(classifyAgentError(new AgentRunError('PROVIDER_AUTH_FAILED', 'm')).authFailed).toBe(true)
    // A 403 is a permission for one model, not a credential that stopped working.
    expect(
      classifyAgentError(named('FetchError', 'provider 403: denied')).authFailed,
    ).toBeUndefined()
    expect(classifyAgentError(named('FetchError', 'provider 429: slow')).authFailed).toBeUndefined()
  })

  test('rateLimited flags rate-limit and quota caps across every source shape', () => {
    // Transient 429 (HTTP status): retryable AND rate-limited.
    expect(classifyAgentError(named('FetchError', 'provider 429: slow down'))).toMatchObject({
      retryable: true,
      rateLimited: true,
    })
    // Message-only quota cap without a parseable status (how the prolite-plan
    // "usage limit" failures reached us) — terminal, still flagged.
    expect(
      classifyAgentError(new Error('ChatGPT usage limit reached (prolite plan)')),
    ).toMatchObject({ kind: 'fatal', retryable: false, rateLimited: true })
    // AgentRunError rate-limit + insufficient-credits both flag it.
    expect(classifyAgentError(new AgentRunError('PROVIDER_RATE_LIMITED', 'm')).rateLimited).toBe(
      true,
    )
    expect(
      classifyAgentError(new AgentRunError('PROVIDER_INSUFFICIENT_CREDITS', 'm')).rateLimited,
    ).toBe(true)
    // A plain transient overload is NOT a rate limit.
    expect(classifyAgentError(new Error('Overloaded')).rateLimited).toBeUndefined()
  })

  test('message-only transient faults retry (no usable status/class name)', () => {
    // Anthropic mid-stream SSE error surfaces as a plain Error with the overloaded body.
    expect(classifyAgentError(new Error('Overloaded'))).toMatchObject({
      retryable: true,
    })
    // Premature stream end — the response never reached its terminal event.
    expect(classifyAgentError(new Error('stream ended before message_stop'))).toMatchObject({
      retryable: true,
    })
    expect(
      classifyAgentError(new Error('The server had an error while processing your request')),
    ).toMatchObject({ retryable: true })
  })

  test('message-only context overflow routes to compaction (no FetchError wrapper)', () => {
    expect(classifyAgentError(new Error('input tokens exceed the configured limit'))).toMatchObject(
      {
        kind: 'context_overflow',
        shouldCompress: true,
        retryable: false,
      },
    )
  })

  test('throttling text containing "too many tokens" retries instead of compacting', () => {
    const info = classifyAgentError(
      new Error('Throttling error: Too many tokens, please wait before trying again.'),
    )
    expect(info).toMatchObject({ kind: 'fatal', retryable: true })
    expect(info.shouldCompress).toBeUndefined()

    const fetchInfo = classifyAgentError(
      named('FetchError', 'provider 429: rate limit: too many tokens'),
    )
    expect(fetchInfo).toMatchObject({ kind: 'fatal', retryable: true })
    expect(fetchInfo.shouldCompress).toBeUndefined()
  })

  test('unknown plain errors stay non-retryable', () => {
    expect(classifyAgentError(new Error('something exploded'))).toMatchObject({
      kind: 'fatal',
      retryable: false,
    })
  })

  test('a 413 payload-too-large is treated as context overflow → compaction', () => {
    expect(
      classifyAgentError(named('FetchError', 'provider 413: request entity too large')),
    ).toMatchObject({
      kind: 'context_overflow',
      shouldCompress: true,
    })
  })

  test('expanded context-overflow phrasings on a 400 flag compaction', () => {
    expect(classifyAgentError(named('FetchError', 'provider 400: input is too long')).kind).toBe(
      'context_overflow',
    )
    expect(
      classifyAgentError(
        named('FetchError', 'provider 400: this exceeds the maximum allowed tokens'),
      ).kind,
    ).toBe('context_overflow')
  })

  test('transient network drops are retryable (by code, by cause chain, and by message)', () => {
    const byCode = Object.assign(new Error('read econnreset'), { code: 'ECONNRESET' })
    expect(classifyAgentError(byCode)).toMatchObject({
      kind: 'fatal',
      retryable: true,
    })
    const byCause = Object.assign(new Error('request failed'), {
      cause: { code: 'UND_ERR_SOCKET' },
    })
    expect(classifyAgentError(byCause).retryable).toBe(true)
    expect(classifyAgentError(new Error('fetch failed')).retryable).toBe(true)
  })

  test('a string `code` that is not a network code is NOT a network drop', () => {
    // `typeof o.code === 'string' && TRANSIENT_NETWORK_CODES.has(o.code)` — the two halves
    // only ever ran together, so an `||` between them went unnoticed. As an `||`, MEMBERSHIP
    // stops mattering and the mere PRESENCE of a string `code` makes an error a transient
    // network drop: OpenAI's terminal `code: 'insufficient_quota'` would be retried forever
    // against an account that is out of money. The set is the whole point of the check.
    const quota = Object.assign(new Error('You exceeded your current quota'), {
      code: 'insufficient_quota',
    })
    expect(classifyAgentError(quota).retryable).toBe(false)
    const invalid = Object.assign(new Error('bad request'), { code: 'invalid_api_key' })
    expect(classifyAgentError(invalid).retryable).toBe(false)
  })

  test('an unknown error is fatal and echoes its message', () => {
    const info = classifyAgentError(new Error('boom'))
    expect(info.kind).toBe('fatal')
    expect(info.retryable).toBe(false)
    expect(info.userMessage).toContain('boom')
  })

  /**
   * The `status === 0 && isRetryableProviderMessage(...)` arm of the FetchError branch had
   * NO coverage: flipping its `===` to `!==` and its `&&` to `||` both left the suite green.
   * It is the arm that decides a PROXY-MANGLED rejection's fate — a provider error that
   * reached us with no parseable status (a gateway rewrote the body, or the fault arrived as
   * an SSE error event mid-stream). Read it as an AND in both directions, because both
   * directions are a live bug: as an OR, a 401 whose text merely mentions "overloaded"
   * retries forever against a key that will never work; with the `===` inverted, the
   * status-less overload — the case the arm exists for — dies on the first hiccup.
   */
  test('a status-less FetchError is judged on its MESSAGE; a status-BEARING one is not', () => {
    // No status to parse → the message is all there is, and it names a transient fault.
    const mangled = named('FetchError', 'Overloaded')
    expect(extractProviderStatus(mangled)).toBe(0) // the precondition the arm keys on
    expect(classifyAgentError(mangled)).toMatchObject({ retryable: true })

    // No status, and a message that names nothing transient → fatal. (Dies if `&&` → `||`:
    // `status === 0` alone would then be enough to retry every unparseable rejection.)
    expect(classifyAgentError(named('FetchError', 'provider said no')).retryable).toBe(false)

    // A parsed, terminal status is NOT rescued by transient-sounding prose. (Dies if `&&` →
    // `||`.) An auth failure that happens to say "please try again" must still be fatal —
    // retrying a 401 burns the run against a key that cannot work.
    expect(
      classifyAgentError(named('FetchError', 'provider 401: bad key, please try again')).retryable,
    ).toBe(false)

    // And a quota cap still wins over transient prose even with no status (`limitCapped`).
    expect(
      classifyAgentError(named('FetchError', 'Overloaded: you exceeded your quota')).retryable,
    ).toBe(false)
  })

  test('the classifier never throws on a non-object throwable', () => {
    // `classifyAgentError` IS the loop's error handler. If it throws, the handler that was
    // meant to contain the failure becomes the failure. `throw 'string'` and `throw null`
    // are legal, and a plugin tool does both.
    expect(() => classifyAgentError(null)).not.toThrow()
    expect(() => classifyAgentError(undefined)).not.toThrow()
    expect(() => classifyAgentError('boom')).not.toThrow()
    expect(classifyAgentError(null).kind).toBe('fatal')
  })
})

describe('extractProviderStatus', () => {
  test('prefers a numeric status property (statusCode / status / code)', () => {
    expect(extractProviderStatus({ statusCode: 503 })).toBe(503)
    expect(extractProviderStatus({ status: 429 })).toBe(429)
    expect(extractProviderStatus({ code: 404 })).toBe(404) // the third loop key
    expect(extractProviderStatus({ data: { error: { code: 403 } } })).toBe(403)
  })
  test('ignores out-of-HTTP-range numeric properties (a token count is not a status)', () => {
    // < 100 or >= 600 must NOT be treated as a status — fall through to the message scan.
    expect(extractProviderStatus({ statusCode: 42 })).toBe(0)
    expect(extractProviderStatus({ status: 1000 })).toBe(0)
  })

  /**
   * The test above states the range in a COMMENT and then asserts 42 and 1000 — values so far
   * outside it that `>=`/`<` could be `>`/`<=` (or the `&&` an `||`) and nothing would notice.
   * The prose was the only thing pinning the boundary, and prose does not run. A status is
   * where the retry/failover/compact decision comes from, so the edges get asserted.
   */
  test('the HTTP range is inclusive at 100 and exclusive at 600 — asserted AT the edges', () => {
    expect(extractProviderStatus({ statusCode: 100 })).toBe(100) // dies if `>= 100` → `> 100`
    expect(extractProviderStatus({ statusCode: 599 })).toBe(599)
    expect(extractProviderStatus({ statusCode: 99 })).toBe(0)
    expect(extractProviderStatus({ statusCode: 600 })).toBe(0) // dies if `< 600` → `<= 600`
    // The nested `data.error.code` shape obeys the same bounds — it is a second copy of the
    // rule, so it needs a second copy of the proof.
    expect(extractProviderStatus({ data: { error: { code: 100 } } })).toBe(100)
    expect(extractProviderStatus({ data: { error: { code: 600 } } })).toBe(0)
  })

  test('a non-object throwable yields 0 rather than crashing the classifier', () => {
    // `error && typeof error === 'object'` — as an `||`, `typeof null === 'object'` is true
    // and the property loop dereferences null.
    expect(extractProviderStatus(null)).toBe(0)
    expect(extractProviderStatus(undefined)).toBe(0)
    expect(extractProviderStatus('provider 503: boom')).toBe(503) // a bare string still scans
  })
  test('falls back to a 3-digit 1xx–5xx code in the message, else 0', () => {
    expect(extractProviderStatus(new Error('provider 429: rate'))).toBe(429)
    expect(extractProviderStatus(new Error('used 700 widgets'))).toBe(0) // 7xx not matched
    expect(extractProviderStatus(new Error('no status here'))).toBe(0)
  })
  test('reads only the provider-label status, never a number in the prose', () => {
    expect(extractProviderStatus(new Error('ollama (llama3:8b) 503: busy'))).toBe(503)
    expect(extractProviderStatus(new Error('provider: got 404 rows back'))).toBe(0)
    expect(extractProviderStatus(new Error('tool failed after 500 ms'))).toBe(0)
  })
})

describe('coerceToolResult', () => {
  test('passes a well-formed result through', () => {
    const r = { content: 'ok', isError: false }
    expect(coerceToolResult(r)).toBe(r)
  })
  test('coerces a non-result value into an error result', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    for (const bad of [
      'a string',
      42,
      null,
      undefined,
      { no: 'content' },
      circular,
      { value: 1n },
    ]) {
      const r = coerceToolResult(bad)
      expect(r.isError).toBe(true)
      expect(typeof r.content).toBe('string')
    }
  })
})
