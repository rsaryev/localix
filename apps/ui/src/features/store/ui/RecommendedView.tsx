import { useEffect } from 'react'
import { SectionHeading } from '@localixai/kit/section-heading'
import { useStoreRecommendations } from '@/shared/hooks/useStoreRecommendations'
import { markRecommendationsSeen, recommendationKey } from '@/shared/lib/recommendationsSeen'
import { listColumns, useStoreFrame } from '../model/layout'
import { useStoreScope } from '../model/storeContext'
import { keyOf } from '../model/useExtrasAfterInstall'
import { ListingRow } from './ListingCards'
import { ListSkeleton, PagedList } from './PagedList'

/**
 * Every recommendation for the work, best first (`/rpc/store/recommendations`): what meaning found
 * for the open tabs, chips, project and installs, then trusted packages by score. Shown here, they
 * have been told about, so the composer's notice rests until something new suits the work.
 */
export function RecommendedView() {
  const store = useStoreScope()
  const { layout, width } = useStoreFrame()
  const answer = useStoreRecommendations(store.client, store.project?.id ?? null, store.sessionId)
  const data = answer.data
  useEffect(() => {
    if (data)
      markRecommendationsSeen(
        data.listings.slice(0, data.matched).map((l) => recommendationKey(l.ref)),
      )
  }, [data])
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
          render={(listing) => <ListingRow listing={listing} />}
          hasMore={false}
          loadMore={() => {}}
          loadingMore={false}
        />
      ) : (
        <ListSkeleton columns={listColumns(layout, width)} />
      )}
    </div>
  )
}
