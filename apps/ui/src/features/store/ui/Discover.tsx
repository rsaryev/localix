import { useEffect, useMemo } from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import type {
  Collection,
  DiscoverResponse,
  Listing,
  ListingRef,
  RecommendReason,
} from '@localixai/store'
import { Button } from '@localixai/kit/button'
import { SectionHeading } from '@localixai/kit/section-heading'
import { ShelfRow } from '@localixai/kit/shelf-row'
import { Skeleton } from '@localixai/kit/skeleton'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'
import {
  reportRecommendationOpened,
  reportRecommendationsShown,
} from '@/shared/lib/recommendationEvents'
import { plural } from '../model/presentation'
import { tileColumns, useStoreFrame } from '../model/layout'
import { useStoreScope } from '../model/storeContext'
import { keyOf } from '../model/useExtrasAfterInstall'
import { Categories } from './DiscoverCategories'
import { ListingTileCard } from './ListingCards'
import { ListingIcon } from './StoreMarks'

/** What a computed row's "See all" opens: the shelf it previews, or just its own items. */
const SEE_ALL: Record<string, { shelf: string } | undefined> = {
  'kind:mini-app': { shelf: 'package:mini-app' },
  'kind:plugin': { shelf: 'package:plugin' },
}

/** An editor's collection as a wide card: its title, its line, and the icons of what it holds. */
function CollectionCard({ collection, listings }: { collection: Collection; listings: Listing[] }) {
  const store = useStoreScope()
  return (
    <button
      type="button"
      aria-label={`${collection.title}, ${plural(collection.items.length, 'package')}`}
      onClick={() =>
        store.show({
          type: 'list',
          title: collection.title,
          subtitle: collection.subtitle,
          refs: collection.items,
        })
      }
      className="@container/collection min-w-0 rounded-xl border border-border-faint bg-card p-4 text-left transition-colors duration-(--dur-fast) hover:bg-surface-hover focus-ring"
    >
      <span className="flex min-w-0 flex-col gap-3">
        {/* What it holds, as a stack of icons; the words get the card's whole width. */}
        <span aria-hidden className="flex items-center">
          {listings.slice(0, 5).map((listing) => (
            <span key={keyOf(listing.ref)} className="-ml-2 rounded-xl ring-2 ring-card first:ml-0">
              <ListingIcon listing={listing} size={40} />
            </span>
          ))}
          <ChevronRight className="ml-auto size-4 shrink-0 text-text-faint" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-base font-semibold text-balance text-foreground">
            {collection.title}
          </span>
          {collection.subtitle && (
            <span className="line-clamp-2 text-xs text-text-soft">{collection.subtitle}</span>
          )}
          <span className="text-2xs text-text-faint">
            {plural(collection.items.length, 'package')}
          </span>
        </span>
      </span>
    </button>
  )
}

const NONE: readonly Listing[] = []
const NO_REASONS: Readonly<Record<string, RecommendReason>> = {}

/** The first look while Discover is read: two rows in outline. */
export function DiscoverSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-8">
      {[0, 1].map((row) => (
        <div key={row} className="flex flex-col gap-3">
          <Skeleton className="h-4 w-40" />
          <div className="grid grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((tile) => (
              <div key={tile} className="flex gap-3 p-2">
                <Skeleton className="size-14 rounded-xl" />
                <div className="flex flex-1 flex-col gap-2 pt-1">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-2.5 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * DISCOVER (`docs/internals/store.md`, "Discover"): the updates waiting, Start here, For your
 * work, For this project, the editors' collections as wide cards, a row per kind, New & updated,
 * and the categories — every part from one `/rpc/store/discover` answer, each left out when
 * empty. For your work is the recommendations' answer (`recommended`), read beside it.
 */
/** How many rows of tiles a Discover row shows; "See all" has the rest. */
const ROWS = 2

export function Discover({
  data,
  recommended = NONE,
  reasons = NO_REASONS,
}: {
  data: DiscoverResponse
  recommended?: readonly Listing[]
  /** Why each recommendation is there, by `kind:id`: what the row reports it showed. */
  reasons?: Readonly<Record<string, RecommendReason>>
}) {
  const store = useStoreScope()
  const { layout, width } = useStoreFrame()
  const columns = tileColumns(width)
  // What the For your work row has on screen: its first rows of tiles.
  useEffect(() => {
    reportRecommendationsShown(
      store.client,
      'discover',
      recommended.slice(0, columns * ROWS),
      reasons,
    )
  }, [store.client, recommended, reasons, columns])
  const byKey = useMemo(() => {
    const map = new Map(data.listings.map((listing) => [keyOf(listing.ref), listing]))
    return (ref: ListingRef) => map.get(keyOf(ref))
  }, [data.listings])
  const listingsOf = (collection: Collection) => collection.items.flatMap((ref) => byKey(ref) ?? [])
  const editorial = data.rows.filter((row) => row.source)
  const computed = (ids: (id: string) => boolean) =>
    data.rows.filter((row) => !row.source && ids(row.id))

  const row = (
    collection: Collection,
    listings = listingsOf(collection),
    onSeeAll?: () => void,
    onOpened?: (listing: Listing, slot: number) => void,
  ) => {
    if (listings.length === 0) return null
    const seeAll = SEE_ALL[collection.id]
    return (
      <ShelfRow
        key={collection.id}
        title={collection.title}
        subtitle={collection.subtitle}
        columns={columns}
        rows={ROWS}
        onSeeAll={
          onSeeAll ??
          (() =>
            store.show({
              type: 'list',
              title: collection.title,
              subtitle: collection.subtitle,
              ...(seeAll ? { query: seeAll } : { refs: collection.items }),
            }))
        }
      >
        {listings.map((listing, slot) => (
          <ListingTileCard
            key={keyOf(listing.ref)}
            listing={listing}
            {...(onOpened ? { onOpened: () => onOpened(listing, slot) } : {})}
          />
        ))}
      </ShelfRow>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      {data.updates.count > 0 && (
        <WorkbenchNoticeBar
          icon={<RefreshCw className="size-4" />}
          title={`${plural(data.updates.count, 'update')} available`}
          actionsLabel="Update actions"
          actions={
            <>
              <Button size="sm" variant="ghost" onClick={() => store.goTo('updates')}>
                See updates
              </Button>
              <Button size="sm" variant="field" onClick={store.updateAll}>
                Update all
              </Button>
            </>
          }
          className="rounded-lg border border-border-faint"
        />
      )}
      {computed((id) => id === 'start').map((collection) => row(collection))}
      {row(
        {
          id: 'work',
          title: 'For your work',
          subtitle: 'Suits what is open beside you',
          style: 'row',
          items: recommended.map((listing) => listing.ref),
        },
        [...recommended],
        () => store.show({ type: 'recommended' }),
        (listing, slot) => reportRecommendationOpened(store.client, listing, slot, reasons),
      )}
      {computed((id) => id === 'project').map((collection) => row(collection))}
      {editorial.length > 0 && (
        <section aria-label="Collections" className="flex flex-col gap-4">
          <SectionHeading level="section" as="h2" title="Collections" />
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: `repeat(${layout === 'narrow' ? 1 : 2}, minmax(0, 1fr))`,
            }}
          >
            {editorial.map((collection) => (
              <CollectionCard
                key={collection.id}
                collection={collection}
                listings={listingsOf(collection)}
              />
            ))}
          </div>
        </section>
      )}
      {computed((id) => id.startsWith('kind:')).map((collection) => row(collection))}
      {computed((id) => id === 'new').map((collection) => row(collection))}
      {data.categories.length > 0 && <Categories categories={data.categories} />}
    </div>
  )
}
