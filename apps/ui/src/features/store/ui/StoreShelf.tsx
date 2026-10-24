import { useMemo } from 'react'
import type { Listing, SourceView } from '@localixai/store'
import { CardGridSection } from '@localixai/kit/card-grid'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { TabBar } from '@localixai/kit/tabs'
import {
  ALL,
  categoriesOf,
  filterListings,
  groupOf,
  keyOf,
  type ShelfFilter,
} from '../model/filters'
import { CATEGORY_LABELS } from '../model/presentation'
import { SourceMenu } from './SourceMenu'
import { StoreCard, type StoreCardProps } from './StoreCard'
import { TagFilterChip } from './StoreMarks'

const GROUPS = [
  { id: 'updates', title: 'Updates' },
  { id: 'installed', title: 'Installed' },
  { id: 'available', title: 'Available' },
] as const

/** Featured on a shelf: what is offered and not here yet, its job included. */
const inFeatured = (listing: Listing) => listing.featured && groupOf(listing) === 'available'

export type CardProps = Omit<StoreCardProps, 'listing' | 'extras' | 'extraProblem'> & {
  extrasFor: (listing: Listing) => StoreCardProps['extras']
  extraProblems: Record<string, string>
}

function Group({
  title,
  rows,
  extrasFor,
  extraProblems,
  ...props
}: { title: string; rows: Listing[] } & CardProps) {
  if (rows.length === 0) return null
  return (
    <CardGridSection title={title} count={rows.length}>
      {rows.map((listing) => (
        <StoreCard
          key={keyOf(listing)}
          listing={listing}
          extras={extrasFor(listing)}
          extraProblem={extraProblems[keyOf(listing)]}
          {...props}
        />
      ))}
    </CardGridSection>
  )
}

/**
 * One shelf: categories as tabs with the tag filter and the source menu beside them, then its
 * listings as cards: Featured on top — the ones not installed yet, each shown there only — then
 * Updates, Installed and Available. Discover shows only Featured and Recommended.
 */
export function StoreShelf({
  listings,
  discover,
  sources,
  filter,
  onFilter,
  onRemoveSource,
  onAddSource,
  ...props
}: {
  listings: Listing[]
  discover?: boolean
  sources: readonly SourceView[]
  filter: ShelfFilter
  onFilter: (patch: Partial<ShelfFilter>) => void
  onRemoveSource: (source: SourceView) => void
  onAddSource?: () => void
} & CardProps) {
  const categories = useMemo(() => categoriesOf(listings), [listings])
  const counts = useMemo(() => {
    const byId: Record<string, number> = {}
    for (const listing of listings) byId[listing.source.id] = (byId[listing.source.id] ?? 0) + 1
    return byId
  }, [listings])
  const shown = filterListings(listings, filter)
  const shelfSources = sources.filter((source) => counts[source.id] || !source.builtIn)
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <TabBar
        aria-label="Categories"
        items={[
          { id: ALL, label: 'All' },
          ...categories.map((id) => ({ id, label: CATEGORY_LABELS[id] ?? id })),
        ]}
        active={filter.category}
        onChange={(category) => onFilter({ category })}
        trailing={
          <div className="flex items-center gap-2">
            {filter.tag && (
              <TagFilterChip tag={filter.tag} onClear={() => onFilter({ tag: null })} />
            )}
            <SourceMenu
              sources={shelfSources}
              counts={counts}
              active={filter.source}
              onChoose={(source) => onFilter({ source })}
              onRemove={(source) => {
                if (filter.source === source.id) onFilter({ source: null })
                onRemoveSource(source)
              }}
              onAdd={onAddSource}
            />
          </div>
        }
      />
      {shown.length === 0 ? (
        <EmptyHint>Nothing matches.</EmptyHint>
      ) : discover ? (
        <>
          <Group title="Featured" rows={shown.filter((l) => l.featured)} {...props} />
          <Group
            title="Recommended"
            rows={shown.filter((l) => l.recommended && !l.featured)}
            {...props}
          />
        </>
      ) : (
        <>
          <Group title="Featured" rows={shown.filter(inFeatured)} {...props} />
          {GROUPS.map(({ id, title }) => (
            <Group
              key={id}
              title={title}
              rows={shown.filter((l) => !inFeatured(l) && groupOf(l) === id)}
              {...props}
            />
          ))}
        </>
      )}
    </div>
  )
}
