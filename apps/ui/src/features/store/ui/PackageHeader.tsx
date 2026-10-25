import { useState, type RefObject } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { Listing } from '@localixai/store'
import { Button } from '@localixai/kit/button'
import { ChipButton } from '@localixai/kit/chip'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { KIND_LABELS } from '../model/presentation'
import { useStoreFrame } from '../model/layout'
import { useStoreScope } from '../model/storeContext'
import { keyOf } from '../model/useExtrasAfterInstall'
import { PageGetAction } from './GetAction'
import { ListingIcon, Publisher } from './StoreMarks'

/** Tags shown before the rest fold into "+N". */
const TAGS = 6

/** Its tags, each opening what else carries it; past six, "+N" shows the rest. */
function Tags({ tags }: { tags: readonly string[] }) {
  const store = useStoreScope()
  const [all, setAll] = useState(false)
  const shown = all ? tags : tags.slice(0, TAGS)
  if (tags.length === 0) return null
  return (
    <ul aria-label="Tags" className="flex flex-wrap gap-1.5">
      {shown.map((tag) => (
        <li key={tag}>
          <ChipButton
            aria-label={`Show packages tagged ${tag}`}
            onClick={() =>
              store.show({ type: 'list', title: `Tagged “${tag}”`, query: { q: tag } })
            }
          >
            {tag}
          </ChipButton>
        </li>
      ))}
      {!all && tags.length > TAGS && (
        <li>
          <ChipButton
            aria-label={`Show ${tags.length - TAGS} more tags`}
            onClick={() => setAll(true)}
          >
            +{tags.length - TAGS}
          </ChipButton>
        </li>
      )}
    </ul>
  )
}

/**
 * A package page's header: back to where it was opened from; its icon in the same tile as every
 * other; its name, one line of what it does, who publishes it and how far that is trusted; its
 * tags; and the Get button with where to get it. In a narrow pane the Get button is pinned to the
 * bottom of the page instead, so it is always in reach.
 */
export function PackageHeader({
  listing,
  heading,
  backLabel,
  onBack,
}: {
  listing: Listing
  heading: RefObject<HTMLHeadingElement | null>
  backLabel: string
  onBack: () => void
}) {
  const { layout } = useStoreFrame()
  const store = useStoreScope()
  const narrow = layout === 'narrow'
  const problem =
    listing.job?.phase === 'failed' ? listing.job.error : store.extraProblems[keyOf(listing.ref)]
  return (
    <>
      <div>
        <Button size="sm" variant="ghost" aria-label="Back" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" aria-hidden />
          {backLabel}
        </Button>
      </div>
      <header className={cn('flex min-w-0 items-start gap-5', narrow && 'gap-4')}>
        <ListingIcon listing={listing} size={narrow ? 72 : 104} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <h1
                ref={heading}
                tabIndex={-1}
                className="text-2xl leading-tight font-semibold text-balance text-foreground outline-none"
              >
                {listing.displayName}
              </h1>
              <p className="line-clamp-2 text-sm text-text-soft">{listing.summary}</p>
            </div>
            {!narrow && <PageGetAction listing={listing} className="pt-0.5" />}
          </div>
          <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-text-soft">
            <Publisher listing={listing} />
            <span aria-hidden>·</span>
            <span>{KIND_LABELS[listing.ref.kind].one}</span>
            {listing.category && (
              <>
                <span aria-hidden>·</span>
                <span>{listing.category}</span>
              </>
            )}
          </p>
          {problem && (
            <p role="alert" className="text-xs text-status-error">
              {problem[0]!.toUpperCase() + problem.slice(1)}
            </p>
          )}
          <div className="pt-1">
            <Tags tags={listing.tags} />
          </div>
        </div>
      </header>
      {narrow && (
        <div className="lx-occluder sticky bottom-0 z-10 -mx-4 order-last flex items-center justify-between gap-3 border-t border-border-faint px-4 py-2">
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {listing.displayName}
          </span>
          <PageGetAction listing={listing} />
        </div>
      )}
    </>
  )
}
