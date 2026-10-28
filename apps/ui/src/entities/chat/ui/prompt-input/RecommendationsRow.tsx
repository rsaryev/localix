import { Sparkles } from 'lucide-react'
import type { Listing } from '@localixai/store'
import { Button } from '@localixai/kit/button'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'
import {
  markRecommendationsSeen,
  recommendationKey,
  unseenRecommendations,
  useRecommendationsSeen,
} from '@/shared/lib/recommendationsSeen'

/** "Docker tools, Kubernetes and 1 more": the first two names, then how many are left. */
function named(listings: readonly Listing[]): string {
  const names = listings.map((listing) => listing.displayName)
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}

/**
 * The Store found packages that suit what the person works on: one quiet row above the composer,
 * like the update offers. Only what meaning found counts (`matched`); the packages that fill the
 * Store's row are no news. See opens them in the Store, ranked; either way they are marked seen,
 * and the row comes back only when something new suits the work.
 */
export function RecommendationsRow({
  answer,
  onSee,
}: {
  answer: { listings: readonly Listing[]; matched: number }
  onSee: () => void
}) {
  useRecommendationsSeen()
  const suited = answer.listings.slice(0, answer.matched)
  const keys = suited.map((listing) => recommendationKey(listing.ref))
  const fresh = unseenRecommendations(keys)
  if (!fresh.length) return null
  return (
    <WorkbenchNoticeBar
      role="status"
      icon={<Sparkles className="size-3.5" />}
      title="Recommended for you"
      description={`${named(suited)} suit what you work on`}
      actionsLabel="Recommendation actions"
      actions={
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="font-normal"
          onClick={() => {
            markRecommendationsSeen(keys)
            onSee()
          }}
        >
          See
        </Button>
      }
      onDismiss={() => markRecommendationsSeen(keys)}
      dismissLabel="Hide until there are new recommendations"
    />
  )
}
