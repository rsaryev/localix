import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

/**
 * One row of the band that scrolls sideways when it does not fit: the wheel scrolls it, ← and →
 * move between its controls, items snap to the start, and a soft fade marks the edge with more
 * behind it. Smooth scrolling only where motion is welcome.
 */

const FOCUSABLE = 'button:not([disabled]), a[href], input, [tabindex="0"]'

export function BandScroller({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: false, end: false })

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = () =>
      setEdges({
        start: node.scrollLeft > 1,
        end: node.scrollLeft + node.clientWidth < node.scrollWidth - 1,
      })
    // A vertical wheel moves the row sideways — only while the row has somewhere to go, so the
    // band's own vertical scroll still works over it.
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      if (node.scrollWidth <= node.clientWidth) return
      node.scrollLeft += event.deltaY
      event.preventDefault()
    }
    measure()
    node.addEventListener('scroll', measure, { passive: true })
    node.addEventListener('wheel', onWheel, { passive: false })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(node)
    return () => {
      node.removeEventListener('scroll', measure)
      node.removeEventListener('wheel', onWheel)
      observer?.disconnect()
    }
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    const at = items.indexOf(document.activeElement as HTMLElement)
    if (at < 0) return
    const next = items[at + (event.key === 'ArrowRight' ? 1 : -1)]
    if (!next) return
    event.preventDefault()
    next.focus()
    next.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  const fade = [
    edges.start ? 'transparent, black 1.5rem' : 'black',
    edges.end ? 'black calc(100% - 1.5rem), transparent' : 'black',
  ].join(', ')
  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        'flex min-w-0 snap-x snap-proximity items-center gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] motion-safe:scroll-smooth [&::-webkit-scrollbar]:hidden [&>*]:shrink-0 [&>*]:snap-start',
        className,
      )}
      style={
        edges.start || edges.end ? { maskImage: `linear-gradient(to right, ${fade})` } : undefined
      }
    >
      {children}
    </div>
  )
}
