import { useEffect } from 'react'
import { ThumbsDown } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { SectionHeading } from '@localixai/kit/section-heading'
import { useStoreRecommendations } from '@/shared/hooks/useStoreRecommendations'
import {
  reportRecommendationOpened,
  reportRecommendationsShown,
} from '@/shared/lib/recommendationEvents'
import { recommendationReason } from '@/shared/lib/recommendationReason'
import { markRecommendationsSeen, recommendationKey } from '@/shared/lib/recommendationsSeen'
import { listColumns, useStoreFrame } from '../model/layout'
import { useStoreScope } from '../model/storeContext'
import { keyOf } from '../model/useExtrasAfterInstall'
import { ListingRow } from './ListingCards'
import { NotRecommended } from './NotRecommended'
import { ListSkeleton, PagedList } from './PagedList'

/**
 * Every recommendation for the work, best first (`/rpc/store/recommendations`): what meaning found
 * for the open tabs, chips, project and installs, then trusted packages by score, each saying why.
 * Not interested turns one down for good (listed below, `NotRecommended`); the server's poke takes
 * it off the list. Shown here,
 * they have been told about, so the composer's notice rests until something new suits the work.
 */
export function RecommendedView() {
  const store = useStoreScope()
  const { layout, width } = useStoreFrame()
  const answer = useStoreRecommendations(store.client, store.project?.id ?? null, store.sessionId)
  const data = answer.data
  useEffect(() => {
    if (!data) return
    markRecommendationsSeen(
      data.listings.slice(0, data.matched).map((l) => recommendationKey(l.ref)),
    )
    reportRecommendationsShown(store.client, 'store-list', data.listings, data.reasons)
  }, [data, store.client])
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <SectionHeading
        title="For your work"
        description="Suits your open tabs, the chat, the project and what you installed"
      />
      {data ? (
        <PagedList
          label="Recommended packages"
          items={data.listings}
          columns={listColumns(layout, width)}
          keyOf={(listing) => keyOf(listing.ref)}
          render={(listing) => (
            <ListingRow
              listing={listing}
              onOpened={() =>
                reportRecommendationOpened(
                  store.client,
                  listing,
                  data.listings.indexOf(listing),
                  data.reasons,
                )
              }
              why={recommendationReason(data.reasons[recommendationKey(listing.ref)])}
              more={
                <IconButton
                  size="lg"
                  className="rounded-full"
                  aria-label={`Not interested in ${listing.displayName}`}
                  tooltip="Not interested"
                  onClick={() => void store.client.dismissRecommendation(listing.ref, true)}
                >
                  <ThumbsDown />
                </IconButton>
              }
            />
          )}
          hasMore={false}
          loadMore={() => {}}
          loadingMore={false}
        />
      ) : (
        <ListSkeleton columns={listColumns(layout, width)} />
      )}
      <NotRecommended />
    </div>
  )
}
