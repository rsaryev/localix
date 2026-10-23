import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { MediaOverlayButton } from '@localixai/kit/media-overlay-button'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { ImageLightbox, useLightboxPaging } from '@/shared/ui/image-lightbox'
import { storeMediaSrc } from '../model/storeFilters'

/** A drag shorter than this is a click, not a swipe. */
const SWIPE_PX = 40

export interface StoreScreenshot {
  url: string
  caption?: string
}

/**
 * An app's screenshots, one at a time at the resolution the app published them — the pane fits
 * the picture, the file is never a smaller copy. Arrows, a swipe, ←/→ and the dots page it; the
 * caption under it is announced; choosing the picture opens it full-window, paged the same way.
 */
export function ScreenshotCarousel({ shots, title }: { shots: StoreScreenshot[]; title: string }) {
  const [index, setIndex] = useState(0)
  const swipeFrom = useRef<number | null>(null)
  const images = shots.map((shot, i) => ({
    src: storeMediaSrc(shot.url),
    name: shot.caption ?? `${title} screenshot ${i + 1}`,
  }))
  const { open, lightbox } = useLightboxPaging(images)
  const count = shots.length
  const go = (next: number) => setIndex(Math.max(0, Math.min(count - 1, next)))
  const current = shots[index]

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft') go(index - 1)
    else if (event.key === 'ArrowRight') go(index + 1)
    else return
    event.preventDefault()
  }
  const onPointerUp = (event: PointerEvent) => {
    if (swipeFrom.current === null) return
    const delta = event.clientX - swipeFrom.current
    swipeFrom.current = null
    if (Math.abs(delta) >= SWIPE_PX) go(index + (delta < 0 ? 1 : -1))
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        role="region"
        aria-roledescription="carousel"
        aria-label={`${title} screenshots`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => (swipeFrom.current = event.clientX)}
        onPointerUp={onPointerUp}
        className="group/carousel relative overflow-hidden rounded-lg bg-surface-sunken focus-ring"
      >
        {shots.map((shot, i) => (
          <div
            key={shot.url}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${count}`}
            hidden={i !== index}
          >
            <button
              type="button"
              aria-label={`View screenshot ${i + 1} full size`}
              className="block w-full cursor-zoom-in"
              onClick={() => open(i)}
            >
              <img
                src={images[i]!.src}
                alt={shot.caption ?? `${title} screenshot ${i + 1}`}
                loading={i === index ? 'eager' : 'lazy'}
                draggable={false}
                className="aspect-[16/10] w-full object-contain select-none"
              />
            </button>
          </div>
        ))}
        {count > 1 && (
          <>
            <MediaOverlayButton
              aria-label="Previous screenshot"
              size="xl"
              disabled={index === 0}
              onClick={() => go(index - 1)}
              className="absolute top-1/2 left-2 -translate-y-1/2 disabled:pointer-events-none disabled:opacity-0"
            >
              <ChevronLeft className="size-5" />
            </MediaOverlayButton>
            <MediaOverlayButton
              aria-label="Next screenshot"
              size="xl"
              disabled={index === count - 1}
              onClick={() => go(index + 1)}
              className="absolute top-1/2 right-2 -translate-y-1/2 disabled:pointer-events-none disabled:opacity-0"
            >
              <ChevronRight className="size-5" />
            </MediaOverlayButton>
          </>
        )}
      </div>
      <div className="flex min-h-5 items-center gap-3">
        <p className="min-w-0 flex-1 truncate text-xs text-text-soft" aria-live="polite">
          {current?.caption ?? ''}
        </p>
        {count > 1 && (
          <div className="flex items-center gap-1">
            {shots.map((shot, i) => (
              <button
                key={shot.url}
                type="button"
                aria-label={`Screenshot ${i + 1} of ${count}`}
                aria-current={i === index ? 'true' : undefined}
                onClick={() => go(i)}
                className="flex size-(--chrome-control-xs) items-center justify-center rounded-full focus-ring"
              >
                <span
                  className={cn(
                    'size-1.5 rounded-full transition-colors',
                    i === index ? 'bg-foreground' : 'bg-foreground/25',
                  )}
                />
              </button>
            ))}
          </div>
        )}
      </div>
      <ImageLightbox {...lightbox} />
    </div>
  )
}
