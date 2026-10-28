/**
 * The delay before retry number `attempt` (0-based): exponential from `baseMs`, capped at
 * `maxMs`, optionally jittered DOWNWARD.
 *
 * The API and the UI had grown one copy of this formula per retry loop — trigger fire backoff,
 * transient provider retries, SQLite busy retries, the event socket's reconnect, the settings save
 * retry, the UI-location catalog sync — each a `Math.min(base * 2 ** n, cap)` or a stateful
 * `delay = Math.min(delay * 2, cap)` with its own edge cases. One of those edges was real: an
 * undefined attempt count turned `2 ** n` into NaN, and `Math.min/Math.max` propagate NaN, so the
 * retry slept for an unspecified time. Here a non-finite or negative attempt is attempt 0, and an
 * overflowing power is the cap — so every caller gets a finite delay in `[0, maxMs]`.
 *
 * Jitter only SHORTENS the delay (by up to `jitter` × delay), so the cap stays a real ceiling and
 * a fleet of clients that failed together does not retry together. It is opt-in: a caller whose
 * tests pin exact delays keeps them.
 *
 * Pure and dependency-free so the API, the browser and the mini apps import the one copy through
 * `@localixai/agent/backoff`.
 */
export interface BackoffPolicy {
  /** Delay before the first retry (attempt 0). */
  baseMs: number
  /** Ceiling on any delay. */
  maxMs: number
  /** Growth per attempt; 2 (doubling) when omitted. */
  factor?: number
  /** Fraction in [0, 1] of the delay that may be randomly removed; 0 (none) when omitted. */
  jitter?: number
}

export function backoffMs(
  attempt: number,
  { baseMs, maxMs, factor = 2, jitter = 0 }: BackoffPolicy,
  random: () => number = Math.random,
): number {
  const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0
  const raw = baseMs * factor ** n
  const capped = Number.isFinite(raw) ? Math.min(raw, maxMs) : maxMs
  const spread = Math.min(Math.max(jitter, 0), 1)
  if (spread === 0) return capped
  return Math.round(capped * (1 - spread * random()))
}

/**
 * Wait `ms`, or until `signal` aborts, whichever comes first. Resolves either way and never
 * throws: the caller looks at the signal to learn which. The one abort-aware sleep of the API.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}
