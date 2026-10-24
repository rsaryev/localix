import { TRUST_WEIGHTS, type Listing } from '@localixai/store'

/**
 * HOW THE STORE ORDERS WHAT IT LISTS (`docs/internals/store-scale.md`, "Ranking"). A listing's
 * static score is computed once, when its source is indexed:
 *
 *   static = trustWeight × (1 + 0.5·featured + 0.3·recommended + 0.2·freshness) × quality
 *
 * Localix has no server for ratings or install counts, so trust, editorial flags, completeness
 * and freshness are all it has. The open project adds a boost at query time (`project-signals.ts`
 * says what the project is written in; `listingSignals` what a listing is about).
 */

const YEAR_MS = 365 * 24 * 60 * 60 * 1000

/** 1 for a version published now, falling to 0 over a year; 0 when the source does not say. */
function freshness(updatedAt: string | undefined, now: number): number {
  const at = updatedAt ? Date.parse(updatedAt) : Number.NaN
  if (Number.isNaN(at)) return 0
  return Math.min(1, Math.max(0, 1 - (now - at) / YEAR_MS))
}

/**
 * 1 for a listing with a description, a category and an icon or tags; down to 0.6 for one with a
 * name only, so empty entries sink without being hidden.
 */
function quality(listing: Listing): number {
  const described = listing.summary.trim() ? 0.5 : 0
  const placed = listing.category && listing.category !== 'Other' ? 0.25 : 0
  const pictured = listing.icon || listing.tags.length > 0 ? 0.25 : 0
  return 0.6 + 0.4 * (described + placed + pictured)
}

export function staticScore(listing: Listing, opts: { now: number }): number {
  const weight = listing.source.weight ?? TRUST_WEIGHTS[listing.source.trust ?? 'community']
  const lift =
    1 +
    (listing.featured ? 0.5 : 0) +
    (listing.recommended ? 0.3 : 0) +
    0.2 * freshness(listing.updatedAt, opts.now)
  return weight * lift * quality(listing)
}

/** Lowercase words of `text`, split where a name joins them (`typescript-lsp`). */
export const signalWords = (text: string): string[] =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

/**
 * What a listing is about, as ` word word … ` (padded, so a whole word is found by ` word `): its
 * name, tags, category and the names of its components. The open project's languages and tools
 * are matched against it.
 */
export function listingSignals(listing: Listing): string {
  const words = new Set(
    signalWords(
      [
        listing.name,
        ...listing.tags,
        listing.category ?? '',
        ...(listing.components ?? []).map((part) => part.name),
      ].join(' '),
    ),
  )
  return ` ${[...words].join(' ')} `
}
