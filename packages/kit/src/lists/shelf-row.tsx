import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Button } from '../controls/button'
import { motionSafeScrollBehavior } from '../lib/use-reduced-motion'

/** The gap between tiles, in rem; the column arithmetic below depends on it. */
const GAP_REM = 1

type Edge = { start: boolean; end: boolean }

export interface ShelfRowProps {
  title: string
  subtitle?: string
  /** How many tiles one view holds; a fraction lets the next one peek in from the edge. */
  perView: number
  /** Open the whole list: the row is a preview of it. */
  onSeeAll?: () => void
  children: ReactNode
  className?: string
}

/**
 * One row of a storefront: a title and a line under it, "See all" for the whole list, and its
 * tiles side by side in a strip that scrolls sideways — by trackpad or a sideways wheel, by
 * swipe, by the arrow buttons that appear on hover or focus, or by tabbing through the tiles. It
 * snaps a tile to the start, fades out at the side where more is hidden, and never widens the
 * page. `perView` says how many tiles fill one view; the host picks it from its pane's width.
 */
export function ShelfRow({
  title,
  subtitle,
  perView,
  onSeeAll,
  children,
  className,
}: ShelfRowProps) {
  const strip = useRef<HTMLUListElement>(null)
  const [edge, setEdge] = useState<Edge>({ start: true, end: true })
  const measure = useCallback(() => {
    const el = strip.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    const next = { start: el.scrollLeft <= 1, end: el.scrollLeft >= max - 1 }
    setEdge((prev) => (prev.start === next.start && prev.end === next.end ? prev : next))
  }, [])
  useEffect(() => {
    const el = strip.current
    if (!el) return
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure])

  const page = (direction: 1 | -1) =>
    strip.current?.scrollBy({
      left: direction * strip.current.clientWidth * 0.9,
      behavior: motionSafeScrollBehavior('smooth'),
    })
  const fade = edge.start && edge.end ? undefined : edge.start ? 'end' : edge.end ? 'start' : 'both'
  // `.lx-glass` sets `position: relative` outside Tailwind's layers, which beats an `absolute`
  // on the button itself and drops it under the strip. So each arrow sits in an absolutely
  // placed rail, as tall as the strip, that centres it and lets clicks through around it.
  const arrow =
    'pointer-events-auto rounded-full lx-glass lx-glass-self opacity-0 group-hover/shelf-row:opacity-100 focus-visible:opacity-100 disabled:opacity-0'
  const rail = 'pointer-events-none absolute inset-y-0 z-10 flex items-center'
  return (
    <section
      aria-label={title}
      className={cn('group/shelf-row flex min-w-0 flex-col gap-3', className)}
    >
      <header className="flex min-w-0 items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="truncate text-xs text-text-soft">{subtitle}</p>}
        </div>
        {onSeeAll && (
          <Button size="sm" variant="ghost" aria-label={`See all ${title}`} onClick={onSeeAll}>
            See all
            <ChevronRight data-icon="inline-end" aria-hidden />
          </Button>
        )}
      </header>
      <div className="relative min-w-0">
        <ul
          ref={strip}
          onScroll={measure}
          data-fade={fade}
          className="lx-fade-x grid snap-x snap-mandatory grid-flow-col overflow-x-auto overscroll-x-contain py-1"
          style={{
            gap: `${GAP_REM}rem`,
            gridAutoColumns: `calc((100% - ${Math.ceil(perView) - 1} * ${GAP_REM}rem) / ${perView})`,
          }}
        >
          {Children.map(children, (child) => (
            <li className="min-w-0 snap-start">{child}</li>
          ))}
        </ul>
        <div data-slot="shelf-arrow" className={cn(rail, 'left-1')}>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Scroll ${title} back`}
            disabled={edge.start}
            onClick={() => page(-1)}
            className={arrow}
          >
            <ChevronLeft aria-hidden />
          </Button>
        </div>
        <div data-slot="shelf-arrow" className={cn(rail, 'right-1')}>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Scroll ${title} forward`}
            disabled={edge.end}
            onClick={() => page(1)}
            className={arrow}
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
    </section>
  )
}
