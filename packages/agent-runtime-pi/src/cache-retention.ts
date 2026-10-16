/**
 * PROMPT-CACHE RETENTION is a provider decision, made here from a host FACT.
 *
 * The host knows one thing the adapter cannot: how long this session sat idle before the turn
 * (`AgentRuntimeRunInput.promptCacheIdleMs`). What that gap is worth — whether a longer, more
 * expensive cache write pays for itself before the next turn — depends entirely on the
 * provider's TTLs and price list, which is adapter knowledge. The host used to compute the
 * answer itself, in `agent-runner-constants.ts`, encoding Anthropic's cost model in a
 * provider-neutral module; a second adapter would have had to obey a policy written for
 * someone else's cache.
 *
 * Anthropic's model (per-million, relative to the base input rate): a 5-minute cache write
 * costs 1.25x, a 1-hour write 2x, and a read 0.1x either way. So, against the observed gap:
 *
 *   gap <= 5m   the 5m cache survives anyway, and is the cheaper write            → 'short'
 *   5m < gap <= 1h  the 5m cache is dead, a 1h cache is not: one 2x write then 0.1x
 *                   reads beats a 1.25x rewrite every turn                        → 'long'
 *   gap > 1h    even the 1h cache is dead, so the cheaper write wins              → 'short'
 *
 * Reading it from the OBSERVED gap is self-correcting: a session pays the 'long' premium only
 * after it has demonstrated a slow cadence (a `/loop` firing every 10 minutes, a delegated run
 * parked on a question, a channel waiting on a human).
 */

/** Above this gap the 5-minute cache is dead by the next turn. */
export const CACHE_TTL_LONG_MIN_IDLE_MS = 5 * 60_000
/** Above this gap even the 1-hour cache is dead, so the cheaper write wins. */
export const CACHE_TTL_LONG_MAX_IDLE_MS = 60 * 60_000

export type PiCacheRetention = 'none' | 'short' | 'long'

export function pickCacheRetention(idleMs: number | undefined): PiCacheRetention | undefined {
  if (typeof idleMs !== 'number' || !Number.isFinite(idleMs) || idleMs < 0) return undefined
  return idleMs > CACHE_TTL_LONG_MIN_IDLE_MS && idleMs <= CACHE_TTL_LONG_MAX_IDLE_MS
    ? 'long'
    : 'short'
}
