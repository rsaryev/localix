import type { PublicTrade } from '../../backend/contracts'

/**
 * Pure reconcilers folding a live `StreamPayload` into the tab's local state. The chart's
 * candle merge already lives in `candleSeries.upsertCandles` (same-`time` last bar replaced,
 * newer appended) and the order book is a wholesale replace, so the only non-trivial case
 * is the TRADE TAPE — an APPEND-only, bounded, de-duplicated feed. Kept pure + unit-tested
 * so the tape's ordering / dedup / bound can't silently drift.
 */

/** How many of the newest trades the tape keeps. */
export const TRADE_TAPE_LIMIT = 100

/** Identity for a trade — its venue id when present, else a value fingerprint (some venues
 *  stream idless public trades). Used to de-duplicate across overlapping frames. */
export function tradeKey(t: PublicTrade): string {
  // A venue that stamps its prints gives a stable synthetic key; one that stamps neither an id nor
  // a time cannot distinguish two identical prints, and this key deliberately collapses them rather
  // than inventing a difference.
  return t.id ?? `${t.timestamp ?? 'undated'}:${t.price}:${t.amount}:${t.side}`
}

/**
 * Prepend a batch of streamed trades so the NEWEST sits on top, de-duplicated against what
 * we already show (and within the batch), bounded to the newest `limit`. The venue delivers
 * a batch oldest→newest, so it is reversed before prepending. Returns the SAME array when the
 * batch adds nothing new, so React can bail out of a no-op render.
 */
export function reconcileTrades(
  prev: PublicTrade[],
  incoming: PublicTrade[],
  limit = TRADE_TAPE_LIMIT,
): PublicTrade[] {
  if (incoming.length === 0) return prev
  const prevKeys = new Set(prev.map(tradeKey))
  const seen = new Set<string>()
  const fresh: PublicTrade[] = []
  // Newest-first: reverse the venue's oldest→newest batch.
  for (const t of [...incoming].reverse()) {
    const k = tradeKey(t)
    if (prevKeys.has(k) || seen.has(k)) continue
    seen.add(k)
    fresh.push(t)
  }
  if (fresh.length === 0) return prev
  const merged = [...fresh, ...prev]
  return merged.length > limit ? merged.slice(0, limit) : merged
}
