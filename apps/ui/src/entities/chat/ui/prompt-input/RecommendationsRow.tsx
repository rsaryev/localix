import { useEffect } from 'react'
import type { Listing, RecommendReason } from '@localixai/store'
import { Button } from '@localixai/kit/button'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'
import { useHoldComposerAdvice } from '@/shared/lib/composerAdvice'
import { recommendationFor } from '@/shared/lib/recommendationReason'
import {
  markRecommendationsSeen,
  recommendationKey,
  unseenRecommendations,
  useRecommendationsSeen,
} from '@/shared/lib/recommendationsSeen'

/**
 * The Store found packages that suit what the person works on: one quiet line above the composer,
 * "Recommended · Docker tools and 2 more for compose.yaml" — the best one named, the rest a
 * count, and what they are for; no glyph, since the title says what it is. Only what meaning
 * found counts (`matched`); the packages that fill the Store's row are no news. See opens them in
 * the Store, ranked, each with its full reason; either way they are marked seen, and the line
 * comes back only when something new suits the work.
 */
export function RecommendationsRow({
  answer,
  onSee,
  onShown,
}: {
  answer: {
    listings: readonly Listing[]
    matched: number
    reasons: Readonly<Record<string, RecommendReason>>
  }
  onSee: () => void
  /** The package it names is on screen (the Store counts it as shown). */
  onShown?: (named: readonly Listing[]) => void
}) {
  useRecommendationsSeen()
  const suited = answer.listings.slice(0, answer.matched)
  const keys = suited.map((listing) => recommendationKey(listing.ref))
  const fresh = unseenRecommendations(keys)
  const told = fresh.length ? suited.slice(0, 1) : []
  const toldKey = told.map((listing) => recommendationKey(listing.ref)).join(',')
  useHoldComposerAdvice(fresh.length > 0)
  useEffect(() => {
    if (told.length) onShown?.(told)
    // `toldKey` says which one is named; the listing objects change with every read.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [toldKey])
  if (!fresh.length) return null
  // The best of them is named, and says what they are for: the rest are a count, not a list.
  const [best] = suited
  const more = suited.length > 1 ? ` and ${suited.length - 1} more` : ''
  return (
    <WorkbenchNoticeBar
      role="status"
      title="Recommended"
      description={`${best!.displayName}${more} ${recommendationFor(answer.reasons[keys[0]!])}`}
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
