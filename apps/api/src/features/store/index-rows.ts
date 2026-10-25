import {
  COMPONENT_KINDS,
  hasUpdate,
  isActiveJob,
  storeCategory,
  TRUST_WEIGHTS,
  type Listing,
  type ListingRef,
  type StoreComponent,
} from '@localixai/store'

import { listingSignals, staticScore } from './ranking'

/**
 * A LISTING AS THE INDEX HOLDS IT, and back. The card — everything a source says, with the
 * category placed among the Store's own (`categories.ts`) — is kept once for everyone; the
 * person's installs, job and settings link are their state, kept per person beside it.
 */

/** What a listing holds that is the person's own, not its source's. */
export type ListingState = Pick<Listing, 'installs' | 'job' | 'configurable'>
export type ListingCard = Omit<Listing, 'installs' | 'job' | 'configurable'>

export interface IndexRow {
  kind: string
  id: string
  source_id: string
  source_label: string
  name: string
  display_name: string
  summary: string
  tags_text: string
  components_text: string
  category: string
  trust: string | null
  featured: number
  recommended: number
  origin: string | null
  publisher: string
  authored: string | null
  bundled: number
  updated_at: string | null
  weight: number
  score: number
  signals: string
  card: string
  components: StoreComponent[]
}

export interface StateRow {
  kind: string
  id: string
  installed: number
  has_update: number
  active_job: number
  scopes: string
  state: string
}

export const refKey = (ref: ListingRef) => `${ref.kind}:${ref.id}`

/** A listing's key back into its ref (`kind:id`; an id may hold colons). */
export function refOf(key: string): ListingRef | null {
  const at = key.indexOf(':')
  if (at <= 0) return null
  return { kind: key.slice(0, at), id: key.slice(at + 1) } as ListingRef
}

/**
 * What it contains one by one: the provider's list, or, when it gave only counts, one row per
 * counted component under the package's name.
 */
export function componentsOf(card: ListingCard): StoreComponent[] {
  if (card.components) return card.components
  if (card.contents === 'unknown') return []
  return COMPONENT_KINDS.flatMap((kind) =>
    Array.from({ length: card.contents === 'unknown' ? 0 : (card.contents[kind] ?? 0) }, () => ({
      kind,
      name: card.displayName,
    })),
  )
}

export function cardOf(listing: Listing): ListingCard {
  const { installs: _installs, job: _job, configurable: _configurable, ...card } = listing
  return { ...card, category: storeCategory(listing) }
}

export function toIndexRow(card: ListingCard, opts: { now: number }): IndexRow {
  const components = componentsOf(card)
  const asListing = { ...card, installs: [] } as Listing
  return {
    kind: card.ref.kind,
    id: card.ref.id,
    source_id: card.source.id,
    source_label: card.source.label,
    name: card.name,
    display_name: card.displayName,
    summary: card.summary,
    tags_text: card.tags.join(' '),
    components_text: components
      .map((part) => [part.name, part.description ?? ''].join(' '))
      .join(' '),
    category: card.category ?? 'Other',
    trust: card.source.trust ?? null,
    featured: card.featured ? 1 : 0,
    recommended: card.recommended ? 1 : 0,
    origin: card.origin ?? null,
    publisher: card.publisher.name,
    authored: card.authored ?? null,
    bundled: card.bundled ? 1 : 0,
    updated_at: card.updatedAt ?? null,
    weight: card.source.weight ?? TRUST_WEIGHTS[card.source.trust ?? 'community'],
    score: staticScore(asListing, opts),
    signals: listingSignals(asListing),
    card: JSON.stringify(card),
    components,
  }
}

/** The person's state of a listing, or null when they have none (nothing installed, no job). */
export function toStateRow(listing: Listing): StateRow | null {
  if (listing.installs.length === 0 && !listing.job && !listing.configurable) return null
  const state: ListingState = {
    installs: listing.installs,
    ...(listing.job ? { job: listing.job } : {}),
    ...(listing.configurable ? { configurable: listing.configurable } : {}),
  }
  return {
    kind: listing.ref.kind,
    id: listing.ref.id,
    installed: listing.installs.length > 0 ? 1 : 0,
    has_update: hasUpdate(listing) ? 1 : 0,
    active_job: isActiveJob(listing.job) ? 1 : 0,
    scopes: `,${listing.installs.map((install) => install.scope).join(',')},`,
    state: JSON.stringify(state),
  }
}

export function fromRow(row: {
  card: string
  state: string | null
  alsoIn?: Listing['alsoIn']
}): Listing {
  const card = JSON.parse(row.card) as ListingCard
  const state = row.state ? (JSON.parse(row.state) as ListingState) : { installs: [] }
  return {
    ...card,
    ...state,
    ...(row.alsoIn?.length ? { alsoIn: row.alsoIn } : {}),
  }
}
