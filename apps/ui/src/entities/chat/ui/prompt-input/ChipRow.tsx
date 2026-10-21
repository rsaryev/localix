import { useEffect, useState, type ReactNode } from 'react'
import { useHorizontalWheelScroll } from '@localixai/kit/lib'
import { cn } from '@localixai/plugin-sdk/ui/classes'

/** How far the fade reaches into the row from an edge that has more chips behind it. */
const FADE = '1.5rem'

/**
 * The composer's row of context chips: one line that scrolls sideways when the chips outgrow it,
 * instead of wrapping into a pile. A mouse wheel scrolls it too (the tab strip's rule), and an edge
 * with more chips past it fades out, since scrollbars are hidden app-wide.
 */
export function ChipRow({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useHorizontalWheelScroll<HTMLDivElement>()
  const [edges, setEdges] = useState({ start: false, end: false })
  useEffect(() => {
    const row = ref.current
    if (!row) return
    const measure = () => {
      const start = row.scrollLeft > 1
      const end = row.scrollLeft + row.clientWidth < row.scrollWidth - 1
      setEdges((current) =>
        current.start === start && current.end === end ? current : { start, end },
      )
    }
    measure()
    row.addEventListener('scroll', measure, { passive: true })
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    for (const chip of row.children) observer.observe(chip)
    return () => {
      row.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [ref, children])
  const mask =
    edges.start || edges.end
      ? `linear-gradient(to right, ${edges.start ? 'transparent' : 'black'}, black ${FADE}, black calc(100% - ${FADE}), ${edges.end ? 'transparent' : 'black'})`
      : undefined
  return (
    <div
      ref={ref}
      // `pt-1 -mt-1`: a scrolling row clips both axes, so it keeps room for a chip's focus ring.
      className={cn(
        'flex min-w-0 items-center gap-1.5 overflow-x-auto overscroll-x-contain -mt-1 pt-1 [&>*]:shrink-0',
        className,
      )}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
    >
      {children}
    </div>
  )
}
