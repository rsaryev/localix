import { Undo2 } from 'lucide-react'
import useSWR from 'swr'
import { IconButton } from '@localixai/kit/icon-button'
import { SectionHeading } from '@localixai/kit/section-heading'
import { useResourceGeneration } from '@/shared/api/resourceGeneration'
import { listColumns, useStoreFrame } from '../model/layout'
import { useStoreScope } from '../model/storeContext'
import { keyOf } from '../model/useExtrasAfterInstall'
import { ListingRow } from './ListingCards'
import { PagedList } from './PagedList'

const WHY = {
  'not-interested': 'You were not interested',
  removed: 'You removed it',
} as const

/**
 * What is kept out of the recommendations (`/rpc/store/recommendations/dismissals`), under them:
 * each with why, and Recommend again to take it back. Read again on the `store-recommendations`
 * poke, which every turning down and taking back sends; nothing shows while it is empty.
 */
export function NotRecommended() {
  const store = useStoreScope()
  const { layout, width } = useStoreFrame()
  const generation = useResourceGeneration('store-recommendations')
  const { data } = useSWR(
    ['store-recommendation-dismissals', generation],
    () => store.client.dismissedRecommendations(),
    { keepPreviousData: true, shouldRetryOnError: false },
  )
  if (!data?.dismissed.length) return null
  return (
    <section aria-label="Not recommended" className="flex min-w-0 flex-col gap-4">
      <SectionHeading
        level="section"
        as="h3"
        title="Not recommended"
        description="Search and the shelves still list these"
      />
      <PagedList
        label="Packages not recommended"
        items={data.dismissed}
        columns={listColumns(layout, width)}
        keyOf={(item) => keyOf(item.listing.ref)}
        render={({ listing, reason }) => (
          <ListingRow
            listing={listing}
            why={WHY[reason]}
            more={
              <IconButton
                size="lg"
                className="rounded-full"
                aria-label={`Recommend ${listing.displayName} again`}
                tooltip="Recommend again"
                onClick={() => void store.client.dismissRecommendation(listing.ref, false)}
              >
                <Undo2 />
              </IconButton>
            }
          />
        )}
        hasMore={false}
        loadMore={() => {}}
        loadingMore={false}
      />
    </section>
  )
}
