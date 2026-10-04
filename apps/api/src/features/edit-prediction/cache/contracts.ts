/**
 * Edit-prediction cache contracts (Phase 4, plan §5 — multi-level cache). This is the
 * L1 BACKEND result cache + single-flight seam. It is entirely OPTIONAL on the engine:
 * when no cache is injected the engine computes exactly as before, so adopting it is
 * byte-for-byte additive on the cache-miss / not-wired path.
 *
 * Values are IMMUTABLE `NextEditResult`s. Only the two SUCCESS outcomes are cacheable —
 * `predicted` (positive) and `empty` (negative). `cancelled`/`deadline_exceeded`/
 * `provider_error`/`no_model` are NEVER cached (a transient failure must not be pinned).
 */

import type { NextEditResult } from '../contracts'

/**
 * L1 backend result cache + single-flight. Keys are opaque SHA fingerprints from
 * {@link buildResultCacheKey}; the cache never inspects document text.
 */
export interface EditPredictionResultCache {
  /** A fresh cached result for this fingerprint, or `undefined` on miss/expiry. */
  get(key: string): NextEditResult | undefined
  /** Store a SUCCESS result (predicted/empty). A non-cacheable outcome is ignored. */
  set(key: string, value: NextEditResult): void
  /**
   * Single-flight compute: identical fingerprints in flight share ONE `factory`
   * invocation. The factory receives a shared abort signal that only fires once EVERY
   * subscriber has unsubscribed (a lone unsubscribe does not cancel shared work). A
   * successful (cacheable) result is written to the cache exactly once. The returned
   * promise resolves with the shared value, or — if this caller's `signal` aborts
   * first — a neutral `cancelled` result for THIS caller while shared work continues
   * for the others.
   */
  run(
    key: string,
    factory: (signal: AbortSignal) => Promise<NextEditResult>,
    signal?: AbortSignal,
  ): Promise<NextEditResult>
  /** Bounded-cache observability (metadata only). */
  stats(): { entries: number; bytes: number; inFlight: number }
}

export interface EditPredictionCacheOptions {
  /** Hard ceiling on retained result bytes; LRU-evicts to stay under it. */
  maxBytes?: number
  /** Positive (has edits) TTL — a prediction may survive a short undo/redo loop. */
  positiveTtlMs?: number
  /** Negative (empty) TTL — cheap to recompute, so it must not suppress fresh intent. */
  negativeTtlMs?: number
  /** Injectable clock for deterministic tests. */
  now?: () => number
}
