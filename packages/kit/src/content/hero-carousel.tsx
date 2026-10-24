import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Button } from '../controls/button'
import { useReducedMotion } from '../lib/use-reduced-motion'

/** A drag shorter than this is a click, not a swipe. */
const SWIPE_PX = 40

export interface HeroSlide {
  id: string
  /** A small label over the title: what kind of thing it is. */
  eyebrow?: string
  title: string
  /** One line on why to look at it. */
  pitch?: string
  /** A wide picture, or art standing in for one. */
  media: ReactNode
  /** Under the pitch: the item's lockup and its action. */
  footer?: ReactNode
}

/** How much room the pane gives it: media beside the text, or on top of it. */
export type HeroLayout = 'wide' | 'medium' | 'narrow'

const FRAME = {
  wide: 'grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] min-h-64 p-6 gap-8',
  medium: 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)] min-h-52 p-5 gap-6',
  narrow: 'grid-cols-1 p-3 gap-3',
} as const

/**
 * A storefront's lead: one to three large cards, one at a time — the text and the item's action
 * on one side and a wide picture on the other, or the picture on top in a narrow pane. Arrows,
 * ←/→, a swipe and the dots page it. It advances on its own every `interval` ms (0: never) unless
 * motion is reduced, and holds still while the pointer or focus is on it, so nothing moves under
 * someone reading it.
 */
export function HeroCarousel({
  label,
  slides,
  layout,
  interval = 8000,
}: {
  /** Names the region: "Featured". */
  label: string
  slides: readonly HeroSlide[]
  layout: HeroLayout
  interval?: number
}) {
  const [index, setIndex] = useState(0)
  const [held, setHeld] = useState(false)
  const reduced = useReducedMotion()
  const swipeFrom = useRef<number | null>(null)
  const count = slides.length
  const go = (next: number) => setIndex(((next % count) + count) % count)

  useEffect(() => {
    if (!interval || reduced || held || count < 2) return
    const timer = setInterval(() => setIndex((at) => (at + 1) % count), interval)
    return () => clearInterval(timer)
  }, [interval, reduced, held, count])

  if (count === 0) return null
  const at = Math.min(index, count - 1)
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'ArrowLeft') go(at - 1)
    else if (event.key === 'ArrowRight') go(at + 1)
    else return
    event.preventDefault()
  }
  const arrow =
    'absolute top-1/2 -translate-y-1/2 rounded-full lx-glass lx-glass-self opacity-0 group-hover/hero:opacity-100 focus-visible:opacity-100'
  return (
    <div className="flex flex-col gap-2">
      <div
        role="region"
        aria-roledescription="carousel"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerEnter={() => setHeld(true)}
        onPointerLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false)
        }}
        onPointerDown={(event) => (swipeFrom.current = event.clientX)}
        onPointerUp={(event) => {
          if (swipeFrom.current === null) return
          const delta = event.clientX - swipeFrom.current
          swipeFrom.current = null
          if (Math.abs(delta) >= SWIPE_PX) go(at + (delta < 0 ? 1 : -1))
        }}
        className="group/hero relative overflow-hidden rounded-xl border border-border-faint bg-card focus-ring"
      >
        {slides.map((slide, i) => (
          <div
            key={slide.id}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${count}`}
            hidden={i !== at}
            className={cn('grid items-center', FRAME[layout])}
          >
            <div
              className={cn(
                'flex min-w-0 flex-col gap-2',
                layout === 'narrow' && 'order-2 px-1 pb-1',
              )}
            >
              {slide.eyebrow && (
                <p className="text-2xs font-semibold tracking-wide text-text-soft uppercase">
                  {slide.eyebrow}
                </p>
              )}
              <h3
                className={cn(
                  'font-semibold text-balance text-foreground',
                  layout === 'wide' ? 'text-2xl' : 'text-xl',
                )}
              >
                {slide.title}
              </h3>
              {slide.pitch && <p className="text-sm text-pretty text-text-soft">{slide.pitch}</p>}
              {slide.footer && <div className="mt-2 min-w-0">{slide.footer}</div>}
            </div>
            <div
              className={cn(
                'relative min-w-0 overflow-hidden rounded-lg bg-surface-sunken',
                layout === 'narrow' ? 'order-1 aspect-[16/9]' : 'aspect-[16/10]',
              )}
            >
              {slide.media}
            </div>
          </div>
        ))}
        {count > 1 && (
          <>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Previous"
              onClick={() => go(at - 1)}
              className={cn(arrow, 'left-2')}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Next"
              onClick={() => go(at + 1)}
              className={cn(arrow, 'right-2')}
            >
              <ChevronRight aria-hidden />
            </Button>
          </>
        )}
      </div>
      {count > 1 && (
        <div className="flex items-center justify-center gap-1">
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              type="button"
              aria-label={`Show slide ${i + 1} of ${count}`}
              aria-current={i === at ? 'true' : undefined}
              onClick={() => go(i)}
              className="flex h-(--chrome-control-xs) items-center justify-center rounded-full px-1 focus-ring"
            >
              <span
                className={cn(
                  'h-1.5 rounded-full transition-[width,background-color] duration-(--dur-base)',
                  i === at ? 'w-4 bg-foreground' : 'w-1.5 bg-foreground/25',
                )}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
