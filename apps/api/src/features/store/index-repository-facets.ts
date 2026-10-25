import type { Kysely } from 'kysely'
import { BROWSABLE_COMPONENT_KINDS, PACKAGE_SHELF_KINDS, type StoreFacets } from '@localixai/store'

import { narrowed, visibleListings, type IndexFilters } from './index-repository-filters'
import type { StoreIndexTables } from './index-repository-open'

/**
 * THE STORE'S FACETS, counted by `GROUP BY` over indexed columns (fast enough at this size that no
 * counts table is kept). The shelves, kinds and the library count every listing the person sees,
 * so the shelf navigation stays put while a shelf is filtered; categories and sources count the
 * filtered set, each ignoring its own filter.
 */
export async function facetsOf(
  db: Kysely<StoreIndexTables>,
  userId: string,
  filters: IndexFilters,
): Promise<StoreFacets> {
  const visible = () => visibleListings(db, userId)
  const [kinds, parts, categories, sources] = await Promise.all([
    visible()
      .select((eb) => [
        'l.kind',
        eb.fn.countAll<number>().as('n'),
        eb.fn
          .sum<number>(
            eb
              .case()
              .when(eb.or([eb('l.featured', '=', 1), eb('l.recommended', '=', 1)]))
              .then(1)
              .else(0)
              .end(),
          )
          .as('picked'),
        eb.fn.sum<number>(eb.fn.coalesce('s.installed', eb.lit(0))).as('installed'),
        eb.fn.sum<number>(eb.fn.coalesce('s.has_update', eb.lit(0))).as('updates'),
        eb.fn
          .sum<number>(eb.case().when('l.authored', '=', 'user').then(1).else(0).end())
          .as('yours'),
      ])
      .groupBy('l.kind')
      .execute(),
    visible()
      .innerJoin('listing_component as c', 'c.listing', 'l.pk')
      .select((eb) => ['c.kind', eb.fn.countAll<number>().as('n')])
      .groupBy('c.kind')
      .execute(),
    narrowed(visible(), { ...filters, category: undefined })
      .select((eb) => ['l.category', eb.fn.countAll<number>().as('n')])
      .groupBy('l.category')
      .execute(),
    narrowed(visible(), { ...filters, source: undefined })
      .select((eb) => ['l.source_id', eb.fn.countAll<number>().as('n')])
      .groupBy('l.source_id')
      .execute(),
  ])
  const sum = (pick: (row: (typeof kinds)[number]) => number) =>
    kinds.reduce((total, row) => total + Number(pick(row) ?? 0), 0)
  const shelves: Record<string, number> = {}
  const set = (key: string, value: number) => {
    if (value > 0) shelves[key] = value
  }
  set(
    'discover',
    sum((row) => row.picked),
  )
  // Only the kinds that are packages and nothing else have a shelf of packages; a skill, agent or
  // MCP server is counted once, on its capability shelf, with the ones inside plugins.
  for (const row of kinds)
    if ((PACKAGE_SHELF_KINDS as readonly string[]).includes(row.kind))
      set(`package:${row.kind}`, Number(row.n))
  const component: Record<string, number> = {}
  for (const row of parts) component[row.kind] = Number(row.n)
  // A capability shelf lists components, so it counts them, not the packages holding them. A
  // standalone skill is one component of its own listing, so it is counted here with the rest.
  for (const kind of BROWSABLE_COMPONENT_KINDS) set(`capability:${kind}`, component[kind] ?? 0)
  const installed = sum((row) => row.installed)
  const updates = sum((row) => row.updates)
  set('installed', installed)
  set('updates', updates)
  set(
    'yours',
    sum((row) => row.yours),
  )
  return {
    shelves,
    kind: Object.fromEntries(kinds.map((row) => [row.kind, Number(row.n)])),
    component,
    category: Object.fromEntries(categories.map((row) => [row.category, Number(row.n)])),
    source: Object.fromEntries(sources.map((row) => [row.source_id, Number(row.n)])),
    installed,
    updates,
  }
}
