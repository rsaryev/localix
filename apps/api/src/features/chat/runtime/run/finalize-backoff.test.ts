import { describe, expect, test } from 'bun:test'

import { rateLimitBackoffMs } from './finalize'
import { MAX_TRUSTED_RETRY_DELAY_MS, type AgentErrorInfo } from '@localixai/agent/agents'

const info = (over: Partial<AgentErrorInfo>): AgentErrorInfo => ({
  kind: 'fatal',
  userMessage: 'x',
  retryable: false,
  ...over,
})

/**
 * The cooldown gates SCHEDULED loop firings only — never a message the user sends — so its
 * job is to not burn runs into an allowance the provider already said is spent.
 *
 * The floors are what we invent when the provider said nothing. A STATED window is honored,
 * and honored past our own invented ceiling: capping the server's own number is how a cooldown
 * expires while the quota is still exhausted, which is the defect this policy had while
 * `retryAfterMs` was unreachable in production and every cooldown was a constant.
 */
describe('rateLimitBackoffMs', () => {
  test('with no stated window, the invented floor applies — 1m transient, 30m for a cap', () => {
    expect(rateLimitBackoffMs(info({ retryable: true, rateLimited: true }))).toBe(60_000)
    // A plan/quota cap will not clear on a short wait, so it gets the long floor.
    expect(rateLimitBackoffMs(info({ retryable: false, rateLimited: true }))).toBe(30 * 60_000)
  })

  test('a stated window inside range is honored verbatim', () => {
    expect(
      rateLimitBackoffMs(info({ retryable: true, rateLimited: true, retryAfterMs: 300_000 })),
    ).toBe(300_000)
  })

  test('a stated window LONGER than our invented ceiling is still honored', () => {
    // The regression this guards: 45m used to be clamped to 15m, so the loop woke up three
    // times inside a window the provider had already described, and each wake spent a run on
    // the same 429. Only the classifier's trusted-hint ceiling may cut a stated value.
    expect(
      rateLimitBackoffMs(info({ retryable: true, rateLimited: true, retryAfterMs: 45 * 60_000 })),
    ).toBe(45 * 60_000)
  })

  test('a stated window shorter than the floor is raised to it, per kind', () => {
    // Below the floor the provider is describing its own retry window, not our loop cadence:
    // re-firing a scheduled run 5s later is how a loop hammers a rate limit.
    expect(
      rateLimitBackoffMs(info({ retryable: true, rateLimited: true, retryAfterMs: 5_000 })),
    ).toBe(60_000)
    // And a cap's 30m floor outranks a short stated window for the same reason.
    expect(
      rateLimitBackoffMs(info({ retryable: false, rateLimited: true, retryAfterMs: 60_000 })),
    ).toBe(30 * 60_000)
  })

  test('a cap that states a LONG reset is honored above its floor', () => {
    // A plan cap that says "resets in 4h" is the one case where the provider knows better
    // than any constant we could pick — up to the trusted ceiling.
    expect(
      rateLimitBackoffMs(
        info({ retryable: false, rateLimited: true, retryAfterMs: 4 * 3_600_000 }),
      ),
    ).toBe(MAX_TRUSTED_RETRY_DELAY_MS)
  })

  test('zero is a real answer, not a missing one', () => {
    // `retry-after: 0` (or an already-past reset date) means "retry now". Treating it as
    // absent would be harmless here, but `||`-ing it away is the bug class that makes a
    // stated window silently unreachable — the floor is what bounds it, not falsiness.
    expect(rateLimitBackoffMs(info({ retryable: true, rateLimited: true, retryAfterMs: 0 }))).toBe(
      60_000,
    )
  })
})
