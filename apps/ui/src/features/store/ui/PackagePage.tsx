import { useEffect, useMemo, useRef, useState } from 'react'
import type { Listing, ListingDetail, ListingRef, StoreComponent } from '@localixai/store'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { ShelfRow } from '@localixai/kit/shelf-row'
import { Skeleton } from '@localixai/kit/skeleton'
import { MediaCarousel } from '@localixai/kit/media-carousel'
import { ImageLightbox, useLightboxPaging } from '@/shared/ui/image-lightbox'
import { MarkdownRenderer } from '@/shared/ui/MarkdownRenderer'
import { storeMediaSrc } from '@/shared/ui/MiniAppIcon'
import { tilesPerView, useStoreFrame } from '../model/layout'
import { useStoreScope } from '../model/storeContext'
import { keyOf } from '../model/useExtrasAfterInstall'
import { useListingDetail } from '../model/useStoreData'
import { ListingTileCard } from './ListingCards'
import { PackageFacts, packageFacts } from './PackageFacts'
import { PackageHeader } from './PackageHeader'
import { PackageSections } from './PackageSections'

/** The package's pictures, each opening full-window, paged the same way. */
function Pictures({ media, title }: { media: ListingDetail['media']; title: string }) {
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

/** "More from Ada", "You might also like": a row of what the page's detail names. */
function Related({
  title,
  refs,
  linked,
}: {
  title: string
  refs?: ListingRef[]
  linked: Listing[]
}) {
  const { layout, width } = useStoreFrame()
  const byKey = useMemo(() => new Map(linked.map((l) => [keyOf(l.ref), l])), [linked])
  const listings = (refs ?? []).flatMap((ref) => byKey.get(keyOf(ref)) ?? [])
  if (listings.length === 0) return null
  return (
    <ShelfRow title={title} perView={tilesPerView(layout, width)}>
      {listings.map((listing) => (
        <ListingTileCard key={keyOf(listing.ref)} listing={listing} />
      ))}
    </ShelfRow>
  )
}

/** The description: the package's own README, as the chat renders markdown, at reading width. */
function Description({ listing, detail }: { listing: Listing; detail: ListingDetail | undefined }) {
  const [whole, setWhole] = useState(false)
  if (!detail)
    return (
      <div aria-hidden className="flex flex-col gap-2">
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    )
  if (!detail.readme) return <p className="text-sm text-text-soft">{listing.summary}</p>
  const long = detail.readme.length > 1800
  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          'relative min-w-0 text-sm',
          long && !whole && 'max-h-96 overflow-hidden lx-fade-y',
        )}
        data-fade={long && !whole ? 'end' : undefined}
      >
        <MarkdownRenderer rawHtml={false}>{detail.readme}</MarkdownRenderer>
      </div>
      {long && (
        <button
          type="button"
          className="self-start rounded-sm text-xs font-medium text-foreground underline-offset-2 hover:underline focus-ring"
          onClick={() => setWhole((was) => !was)}
        >
          {whole ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  )
}

/**
 * A PACKAGE'S PAGE (`docs/internals/store.md`, "Package page"), laid out as app stores lay
 * theirs: the header with its Get, the facts, the pictures, the description, then What's inside,
 * Permissions and Versions, then more from its publisher and what is like it. It draws at once
 * from the listing in hand and fills in as the detail arrives — a remote plugin is fetched the
 * first time it is opened, so What's inside says it is reading meanwhile.
 */
export function PackagePage({
  listing: inHand,
  reference,
  focus,
  backLabel,
  onBack,
}: {
  listing?: Listing
  reference: ListingRef
  focus?: Pick<StoreComponent, 'kind' | 'name'>
  backLabel: string
  onBack: () => void
}) {
  const store = useStoreScope()
  const { layout } = useStoreFrame()
  const { data: detail } = useListingDetail(store.client, reference, store.project?.id ?? null)
  const listing: Listing | undefined = detail ?? inHand
  const heading = useRef<HTMLHeadingElement>(null)
  // The page replaces the list: focus its heading, so a screen reader starts here.
  useEffect(() => heading.current?.focus(), [reference.kind, reference.id])
  if (!listing)
    return (
      <div aria-busy className="flex flex-col gap-6">
        <div className="flex gap-5">
          <Skeleton className="size-24 rounded-2xl" />
          <div className="flex flex-1 flex-col gap-2 pt-2">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      </div>
    )
  const facts = packageFacts(listing, detail)
  const beside = layout === 'wide'
  return (
    <article data-store-page={listing.ref.id} className="flex min-w-0 flex-col gap-6 pb-2">
      <PackageHeader listing={listing} heading={heading} backLabel={backLabel} onBack={onBack} />
      {!beside && <PackageFacts facts={facts} as="strip" />}
      <div
        className={cn(
          'grid min-w-0 gap-8',
          beside && 'grid-cols-[minmax(0,1fr)_16rem] items-start',
        )}
      >
        <div className="flex min-w-0 flex-col gap-8">
          {detail && detail.media.length > 0 && (
            <Pictures media={detail.media} title={listing.displayName} />
          )}
          <section aria-label="Description" className="max-w-(--reading-measure) min-w-0">
            <Description listing={listing} detail={detail} />
          </section>
          <PackageSections listing={listing} detail={detail} focus={focus} />
        </div>
        {beside && (
          <aside className="sticky top-2">
            <PackageFacts facts={facts} as="card" />
          </aside>
        )}
      </div>
      {detail?.linked && (
        <>
          <Related
            title={`More from ${listing.publisher.name}`}
            refs={detail.related}
            linked={detail.linked}
          />
          <Related title="You might also like" refs={detail.similar} linked={detail.linked} />
        </>
      )}
    </article>
  )
}
