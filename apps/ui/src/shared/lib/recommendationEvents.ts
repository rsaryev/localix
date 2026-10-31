import type { Listing, RecommendEvent, RecommendReason } from '@localixai/store'
import type { StoreClient } from '@/shared/api/store-client'
import { recommendationKey } from './recommendationsSeen'

/**
 * What a surface tells the Store about the recommendations it shows (`docs/internals/store.md`,
 * "Recommendations"): each one shown, with its place and what found it, and the one the person
 * opens. The Store counts showings by day, so a surface reports a package once a day, however
 * often it renders it; a report that fails is not retried, it is a hint and the next day reports
 * again.
 */

type Reporter = Pick<StoreClient, 'recordRecommendationEvents'>

/** Per client, what was reported shown today: `day|surface|kind:id`. */
const reported = new WeakMap<Reporter, Set<string>>()
const today = () => new Date().toISOString().slice(0, 10)

const eventOf = (
  event: RecommendEvent['event'],
  listing: Listing,
  slot: number,
  reasons: Readonly<Record<string, RecommendReason>>,
): RecommendEvent => {
  const source = reasons[recommendationKey(listing.ref)]?.source
  return { ref: listing.ref, event, slot, ...(source ? { source } : {}) }
}

/** These recommendations are on screen, in this order, on `surface`. */
export function reportRecommendationsShown(
  client: Reporter,
  surface: string,
  listings: readonly Listing[],
  reasons: Readonly<Record<string, RecommendReason>>,
): void {
  const seen = reported.get(client) ?? new Set<string>()
  reported.set(client, seen)
  const fresh = listings.flatMap((listing, slot) => {
    const key = `${today()}|${surface}|${recommendationKey(listing.ref)}`
    if (seen.has(key)) return []
    seen.add(key)
    return [eventOf('shown', listing, slot, reasons)]
  })
  if (fresh.length) void client.recordRecommendationEvents(fresh).catch(() => {})
}

/** The person opened the recommendation in `slot`. */
export function reportRecommendationOpened(
  client: Reporter,
  listing: Listing,
  slot: number,
  reasons: Readonly<Record<string, RecommendReason>>,
): void {
  void client
    .recordRecommendationEvents([eventOf('opened', listing, slot, reasons)])
    .catch(() => {})
}
