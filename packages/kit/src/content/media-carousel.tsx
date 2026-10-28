import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { MediaOverlayButton } from '../controls/media-overlay-button'

/** A drag shorter than this is a click, not a swipe. */
const SWIPE_PX = 40

export interface MediaCarouselItem {
  /** The picture's address, as the host serves it. */
  src: string
  caption?: string
}

/**
 * Pictures one at a time at the resolution they were published — the pane fits the picture, the
 * file is never a smaller copy. Arrows, a swipe, ←/→ and the dots page it; the caption under it is
 * announced; choosing the picture calls `onOpen` with its index (the host opens it full-window).
 */
export function MediaCarousel({
  items,
  title,
  onOpen,
}: {
  items: readonly MediaCarouselItem[]
  /** What the pictures are of: names the region and each picture without a caption. */
  title: string
  onOpen?: (index: number) => void
}) {
  const [index, setIndex] = useState(0)
  const swipeFrom = useRef<number | null>(null)
  const count = items.length
  const go = (next: number) => setIndex(Math.max(0, Math.min(count - 1, next)))
  const current = items[index]

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
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Arrow keys and swipe step the slides; the region is the carousel widget itself */}
      <div
        role="region"
        aria-roledescription="carousel"
        aria-label={`${title} screenshots`}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the carousel is one focus stop whose Arrow keys step the slides
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => (swipeFrom.current = event.clientX)}
        onPointerUp={onPointerUp}
        className="group/carousel relative overflow-hidden rounded-lg bg-surface-sunken focus-ring"
      >
        {items.map((item, i) => (
          <div
            key={item.src}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${count}`}
            hidden={i !== index}
          >
            <button
              type="button"
              aria-label={`View screenshot ${i + 1} full size`}
              className="block w-full cursor-zoom-in"
              onClick={() => onOpen?.(i)}
            >
              <img
                src={item.src}
                alt={item.caption ?? `${title} screenshot ${i + 1}`}
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
            {items.map((item, i) => (
              <button
                key={item.src}
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
    </div>
  )
}
