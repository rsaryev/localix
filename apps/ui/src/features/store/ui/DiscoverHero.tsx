import type { Collection, Listing } from '@localixai/store'
import { HeroCarousel, type HeroSlide } from '@localixai/kit/hero-carousel'
import { storeMediaSrc } from '@/shared/ui/MiniAppIcon'
import { KIND_LABELS } from '../model/presentation'
import { useStoreFrame } from '../model/layout'
import { useStoreScope } from '../model/storeContext'
import { GetAction } from './GetAction'
import { ListingIcon, Publisher } from './StoreMarks'

/** Where a hero has no picture: its icon, large, over a soft glow of itself. */
function IconArt({ listing }: { listing: Listing }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
      <div aria-hidden className="absolute scale-[2.6] opacity-50 blur-2xl">
        <ListingIcon listing={listing} size={120} />
      </div>
      <div className="relative drop-shadow-xl">
        <ListingIcon listing={listing} size={112} />
      </div>
    </div>
  )
}

/** The lockup under a hero's pitch: icon, name, publisher and the Get button. */
function Lockup({ listing }: { listing: Listing }) {
  const store = useStoreScope()
  return (
    <div className="flex min-w-0 items-center gap-3">
      <ListingIcon listing={listing} size={44} />
      <button
        type="button"
        className="flex min-w-0 flex-1 flex-col rounded-sm text-left focus-ring"
        aria-label={`About ${listing.displayName}`}
        onClick={() => store.open(listing)}
        onPointerEnter={() => store.prefetch(listing.ref)}
      >
        <span className="truncate text-sm font-medium text-foreground">{listing.displayName}</span>
        <Publisher listing={listing} className="text-xs text-text-soft" />
      </button>
      <GetAction listing={listing} size="md" />
    </div>
  )
}

/**
 * Discover's lead: the editorial hero first, then up to two of what Start here leads with, one
 * at a time. A slide's picture is the hero's own image when it has one, else the listing's icon
 * as art; its pitch is the editor's words, else the listing's summary.
 */
export function DiscoverHero({
  hero,
  start,
  byKey,
}: {
  hero: Collection | null
  start: Collection | undefined
  byKey: (ref: Collection['items'][number]) => Listing | undefined
}) {
  const { layout } = useStoreFrame()
  const refs = [...(hero?.items.slice(0, 1) ?? []), ...(start?.items ?? [])]
  const seen = new Set<string>()
  const slides: HeroSlide[] = []
  for (const ref of refs) {
    const listing = byKey(ref)
    const key = `${ref.kind}/${ref.id}`
    if (!listing || seen.has(key) || slides.length === 3) continue
    seen.add(key)
    const lead = slides.length === 0 && hero ? hero : null
    slides.push({
      id: key,
      eyebrow: KIND_LABELS[listing.ref.kind].one,
      title: lead?.title ?? listing.displayName,
      pitch: lead?.subtitle ?? listing.summary,
      media: lead?.image ? (
        <img
          src={storeMediaSrc(lead.image)}
          alt=""
          className="absolute inset-0 size-full object-cover"
          draggable={false}
        />
      ) : (
        <IconArt listing={listing} />
      ),
      footer: <Lockup listing={listing} />,
    })
  }
  if (slides.length === 0) return null
  return <HeroCarousel label="Featured" slides={slides} layout={layout} />
}
