import type { ExpressionBuilder, Kysely, SelectQueryBuilder } from 'kysely'
import type { Scope, ShelfId, StoreCategory, Trust } from '@localixai/store'

import type { StoreIndexTables } from './index-repository-open'

/**
 * WHAT NARROWS THE INDEX (`docs/internals/store-scale.md`, "Query path"): a shelf, a scope,
 * installed or not, a category, a source and a trust — every one an indexed column of the
 * listing or of the person's state beside it.
 */
export interface IndexFilters {
  shelf?: ShelfId
  scope?: Scope
  installed?: boolean
  category?: StoreCategory
  source?: string
  trust?: Trust
  /** Only what an editorial source recommends. */
  recommended?: boolean
  /** Never a community listing (Discover's picks). */
  trusted?: boolean
  /** Only a version published since then (ISO 8601). */
  updatedSince?: string
  /** Only listings of this publisher, or of this category. */
  publisher?: string
}

type Tables = StoreIndexTables & {
  l: StoreIndexTables['listing']
  s: StoreIndexTables['listing_state']
}

/** The listings one person sees, with their state beside each: `l` and `s`. */
export function visibleListings(db: Kysely<StoreIndexTables>, userId: string) {
  return (
    db
      .selectFrom('listing as l')
      .leftJoin('listing_state as s', (join) =>
        join.onRef('s.kind', '=', 'l.kind').onRef('s.id', '=', 'l.id').on('s.user_id', '=', userId),
      )
      // A duplicate under a higher-weight source is hidden, unless it is the copy installed.
      .where((eb) => eb.or([eb('l.hidden', '=', 0), eb('s.installed', '=', 1)]))
  )
}

type Visible = ReturnType<typeof visibleListings>
type Eb = ExpressionBuilder<Tables, 'l' | 's'>

function onShelf(eb: Eb, shelf: ShelfId) {
  if (shelf === 'discover') return eb.or([eb('l.featured', '=', 1), eb('l.recommended', '=', 1)])
  if (shelf === 'installed') return eb('s.installed', '=', 1)
  if (shelf === 'updates') return eb('s.has_update', '=', 1)
  if (shelf === 'yours' || shelf === 'project')
    return eb('l.authored', '=', shelf === 'yours' ? 'user' : 'project')
  const [group, kind] = shelf.split(':') as ['package' | 'capability', string]
  if (group === 'package') return eb('l.kind', '=', kind)
  return eb.exists(
    eb
      .selectFrom('listing_component as c')
      .select('c.listing')
      .whereRef('c.listing', '=', 'l.pk')
      .where('c.kind', '=', kind),
  )
}

export function narrowed<O>(
  query: SelectQueryBuilder<Tables, 'l' | 's', O>,
  filters: IndexFilters,
): SelectQueryBuilder<Tables, 'l' | 's', O> {
  let out = query
  if (filters.shelf) {
    const shelf = filters.shelf
    out = out.where((eb) => onShelf(eb, shelf))
  }
  if (filters.scope) out = out.where('s.scopes', 'like', `%,${filters.scope},%`)
  if (filters.installed === true) out = out.where('s.installed', '=', 1)
  if (filters.installed === false)
    out = out.where((eb) => eb.or([eb('s.installed', 'is', null), eb('s.installed', '=', 0)]))
  if (filters.category) out = out.where('l.category', '=', filters.category)
  if (filters.source) out = out.where('l.source_id', '=', filters.source)
  if (filters.trust) out = out.where('l.trust', '=', filters.trust)
  if (filters.recommended) out = out.where('l.recommended', '=', 1)
  if (filters.trusted) out = out.where('l.trust', '!=', 'community')
  if (filters.updatedSince) out = out.where('l.updated_at', '>=', filters.updatedSince)
  if (filters.publisher) out = out.where('l.publisher', '=', filters.publisher)
  return out
}

export type { Visible }
