import { localixUiUri } from '@localixai/uri'
import { z } from 'zod'
import {
  scopeSchema,
  STORE_CATEGORIES,
  trustSchema,
  type Listing,
  type ListingRef,
} from '@localixai/store'

import { ftsOrQuery, queryTerms } from '../../lib/fts-query'
import { bestFieldScore } from '@localixai/mini-app-sdk/backend'
import type { SearchHit, SearchProvider, SearchQuery } from '@localixai/mini-app-sdk/backend'
import { fuse, isLookupQuery, unitScore, wordCoverage, type FusionInput } from '../search/hybrid'
import type { StoreIndexRepository } from './index-repository'
import type { IndexFilters } from './index-repository-filters'
import { refOf } from './index-rows'

/**
 * THE STORE IN GLOBAL SEARCH (`docs/internals/store-scale.md`, "One search, two places"): one
 * provider in the global registry, asked by the palette (packages not installed, five at most) and
 * by the Store's own search field (`domains: ['store']` with its filters as provider options).
 * Words come from FTS5 over the filtered index, meaning from the Store's semantic collection, and
 * the shared `fuse` puts both on one scale, as `catalogHits` does. Relevance comes first; the
 * static score, lifted by the open project, breaks near ties, so a Localix package stays above an
 * equal community one.
 */

export const STORE_SEARCH_DOMAIN = 'store'
export const STORE_COLLECTION = 'store.listings'
/** Store hits the palette shows below the installed ones. */
export const PALETTE_HITS = 5
const WORD_CANDIDATES = 200
const MEANING_CANDIDATES = 80
/**
 * What a name that is exactly the query adds: as much as a strong match by meaning, so the
 * package called `code-review` leads a search for "code review".
 */
const EXACT_NAME = 3
/** How much of a hit's score the static score decides: enough to order near ties only. */
const TIE_SHARE = 0.15

/**
 * A hit's score in [0, 1]: its relevance, with the static score (in [0, 1], `tie`) deciding near
 * ties only. Recommendations score what installed packages are near on the same scale.
 */
export const relevance = (fused: number, tie: number) =>
  (1 - TIE_SHARE) * unitScore(fused) + TIE_SHARE * tie

/** What the Store's search field sends as `providerOptions`: the shelf and filters it shows. */
export const storeSearchOptionsSchema = z.object({
  filters: z.object({
    shelf: z.string().optional(),
    scope: scopeSchema.optional(),
    installed: z.boolean().optional(),
    category: z.enum(STORE_CATEGORIES).optional(),
    source: z.string().optional(),
    trust: trustSchema.optional(),
  }),
  /**
   * A recommendation (`recommend.ts`): the text is what the person works on, not words they
   * typed, so only meaning finds a listing; a word the two share is no reason to show it.
   */
  related: z.boolean().optional(),
})

/** Where a Store hit leads: the Store, open on the listing's page. */
export const storeListingUri = (ref: ListingRef) =>
  localixUiUri('work-item', ['store'], { kind: ref.kind, id: ref.id })

/** The listing a Store hit names, or null for any other hit. */
export function refOfStoreHit(hit: Pick<SearchHit, 'id'>): ListingRef | null {
  try {
    const params = new URL(hit.id).searchParams
    const [kind, id] = [params.get('kind'), params.get('id')]
    return kind && id ? refOf(`${kind}:${id}`) : null
  } catch {
    return null
  }
}

/** Whether two texts are the same words, whatever joins them. */
const sameWords = (a: string, b: string) => {
  const words = (text: string) =>
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .join(' ')
  return words(a) !== '' && words(a) === words(b)
}

const textOf = (listing: Listing) =>
  [
    listing.displayName,
    listing.name,
    ...listing.tags,
    listing.summary,
    ...(listing.components ?? []).map((part) => part.name),
  ].join(' ')

export function createStoreSearchProvider(deps: {
  index: Pick<StoreIndexRepository, 'wordCandidates' | 'byRefs'>
  /** The person's index is built (the first time, it is waited for). */
  ready: (userId: string) => Promise<void>
  /** The open project's words (`project-signals.ts`). */
  projectWords?: (userId: string, projectId: string | null | undefined) => Promise<Set<string>>
  /** A listing's static score, for the tie-break. */
  staticOf: (listing: Listing) => number
}): SearchProvider {
  return {
    id: STORE_SEARCH_DOMAIN,
    title: 'Store',
    tier: 'eager',
    icon: 'store',
    async search(userId, query: SearchQuery) {
      await deps.ready(userId)
      const options = storeSearchOptionsSchema.safeParse(query.providerOptions)
      // From the palette: what can still be added, a few at most.
      const palette = !options.success
      const filters = (palette ? { installed: false } : options.data.filters) as IndexFilters
      const related = !palette && options.data.related === true
      const terms = related ? [] : queryTerms(query.text, { prefixLast: true })
      const [words, meaning, project] = await Promise.all([
        related
          ? Promise.resolve([])
          : deps.index.wordCandidates(userId, ftsOrQuery(terms), filters, WORD_CANDIDATES),
        query.semantic
          ? query.semantic.similar(STORE_COLLECTION, { limit: MEANING_CANDIDATES }).catch(() => [])
          : Promise.resolve([]),
        deps.projectWords?.(userId, query.projectId) ?? Promise.resolve(new Set<string>()),
      ])
      const byKey = new Map(meaning.map((match) => [match.key, match]))
      const refs = [
        ...words.map((word) => word.ref),
        ...meaning.flatMap((match) => refOf(match.key) ?? []),
      ]
      const listings = await deps.index.byRefs(userId, refs, filters)
      const inputs: FusionInput[] = []
      for (const [key, listing] of listings) {
        const match = byKey.get(key)
        inputs.push({
          key,
          z: match?.z,
          gate: match?.gate,
          textScore: related ? 0 : bestFieldScore([listing.displayName, listing.name], query.text),
          coverage: wordCoverage(terms, textOf(listing)),
        })
      }
      const fused = fuse(inputs, {
        zGate: query.semantic?.zGate ?? Number.POSITIVE_INFINITY,
        lookup: isLookupQuery(terms),
      })
      const hits = fused.map((result): SearchHit => {
        const listing = listings.get(result.key)!
        const about = project.size
          ? [...project].filter((word) => textOf(listing).toLowerCase().includes(word)).length
          : 0
        const tie = Math.min(1, (deps.staticOf(listing) * (1 + 0.25 * Math.min(2, about))) / 3)
        const uri = storeListingUri(listing.ref)
        // A name that says the query outranks a summary that does: words in the name count once
        // more, and a name that is exactly the query as much as a strong match by meaning.
        const named = related
          ? 0
          : wordCoverage(terms, `${listing.displayName} ${listing.name}`) +
            (sameWords(listing.name, query.text) || sameWords(listing.displayName, query.text)
              ? EXACT_NAME
              : 0)
        return {
          id: uri,
          uri,
          domain: STORE_SEARCH_DOMAIN,
          title: listing.displayName,
          subtitle: listing.summary,
          icon: 'store',
          score: relevance(result.score + named, tie),
          matchedBy: result.matchedBy,
        }
      })
      hits.sort((a, b) => b.score - a.score)
      return palette ? hits.slice(0, PALETTE_HITS) : hits
    },
  }
}
