import { useEffect, useRef } from 'react'
import { ArrowLeft, Trash2 } from 'lucide-react'
import type { Listing, StoreComponent } from '@localixai/store'
import { Button } from '@localixai/kit/button'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { MediaCarousel } from '@localixai/kit/media-carousel'
import type { StoreClient } from '@/shared/api/store-client'
import { ImageLightbox, useLightboxPaging } from '@/shared/ui/image-lightbox'
import { storeMediaSrc } from '@/shared/ui/MiniAppIcon'
import { CATEGORY_LABELS } from '../model/presentation'
import { useListingDetail } from '../model/useStoreData'
import { DetailTabs } from './DetailTabs'
import type { StoreInstallExtra } from '@/shared/lib/storeInstallExtra'
import { InstallAction, type ExtraChoice, type ListingActions } from './InstallAction'
import { ListingTile, PublisherMark, TagButton } from './StoreMarks'

/** The listing's pictures, each opening full-window, paged the same way. */
function Pictures({ media, title }: { media: { url: string; caption?: string }[]; title: string }) {
  const items = media.map((shot) => ({ src: storeMediaSrc(shot.url), caption: shot.caption }))
  const { open, lightbox } = useLightboxPaging(
    items.map((item, i) => ({
      src: item.src,
      name: item.caption ?? `${title} screenshot ${i + 1}`,
    })),
  )
  return (
    <>
      <MediaCarousel items={items} title={title} onOpen={open} />
      <ImageLightbox {...lightbox} />
    </>
  )
}

/** An extra an installed listing can have: whether it has it, and how to change that. */
export interface ExtraMade {
  extra: StoreInstallExtra
  has: boolean
  add: () => void
  remove: () => void
}

const NOTHING_MADE: readonly ExtraMade[] = []

/**
 * One listing's page: a hero with its large icon, who publishes it and the actions — Install
 * and each install extra, labelled — its pictures, then the tabs. The live listing drives the
 * actions, so a job's progress shows here as it does on the shelf.
 */
export function StoreDetail({
  client,
  listing,
  backLabel,
  onBack,
  onTag,
  extras,
  made = NOTHING_MADE,
  extraProblem,
  focus,
  ...actions
}: {
  client: StoreClient
  listing: Listing
  backLabel: string
  onBack: () => void
  onTag: (tag: string) => void
  extras?: readonly ExtraChoice[]
  /** For an installed listing, the extras it can have. */
  made?: readonly ExtraMade[]
  extraProblem?: string
  /** The component it was opened for: What's inside opens with it marked. */
  focus?: Pick<StoreComponent, 'kind' | 'name'>
} & ListingActions) {
  const label = listing.displayName
  const heading = useRef<HTMLHeadingElement>(null)
  const { data: detail, error } = useListingDetail(client, listing.ref)
  // The page replaces the shelf: take focus to its heading so a screen reader starts here.
  useEffect(() => heading.current?.focus(), [])
  const installed = listing.installs.length > 0
  return (
    <article data-store-page={listing.ref.id} className="flex min-w-0 flex-col gap-6 px-2">
      <div>
        <Button size="sm" variant="ghost" aria-label="Back to the store" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" aria-hidden />
          {backLabel}
        </Button>
      </div>
      <header className="flex flex-wrap items-start gap-5">
        <ListingTile listing={listing} size={96} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-xl font-semibold text-foreground outline-none"
          >
            {label}
          </h1>
          <p className="flex items-center gap-1.5 text-xs text-text-soft">
            {listing.publisher.verified && <span>{listing.publisher.name}</span>}
            <PublisherMark listing={listing} />
            {listing.category && <span aria-hidden>·</span>}
            {listing.category && (
              <span>{CATEGORY_LABELS[listing.category] ?? listing.category}</span>
            )}
            {listing.version && <span aria-hidden>·</span>}
            {listing.version && <span className="tabular-nums">{listing.version}</span>}
          </p>
          <p className="text-sm text-text-soft">{listing.summary}</p>
          {listing.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {listing.tags.map((tag) => (
                <TagButton key={tag} tag={tag} onTag={onTag} />
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <InstallAction
            listing={listing}
            size="default"
            removeAs="button"
            extras={extras}
            {...actions}
          />
          {installed &&
            made.map(({ extra, has, add, remove }) => (
              <Button key={extra.id} size="default" variant="ghost" onClick={has ? remove : add}>
                {has ? (
                  <Trash2 data-icon="inline-start" aria-hidden />
                ) : (
                  <extra.icon data-icon="inline-start" aria-hidden />
                )}
                {has ? `Remove ${extra.makes}` : `Add ${extra.makes}`}
              </Button>
            ))}
          {extraProblem && (
            <p role="alert" className="max-w-64 text-right text-xs text-status-error">
              {extraProblem[0]!.toUpperCase() + extraProblem.slice(1)}
            </p>
          )}
        </div>
      </header>
      {!detail && !error && <LoadingHint>Loading {label}…</LoadingHint>}
      {error && <p className="text-xs text-status-warning">This page could not be read.</p>}
      {detail && detail.media.length > 0 && <Pictures media={detail.media} title={label} />}
      {detail && <DetailTabs client={client} listing={listing} detail={detail} focus={focus} />}
    </article>
  )
}
