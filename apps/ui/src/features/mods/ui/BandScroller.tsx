import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

/**
 * One row of the band that scrolls sideways when it does not fit: the wheel scrolls it, ← and →
 * move between its controls, items snap to the start, and a soft fade marks the edge with more
 * behind it. Smooth scrolling only where motion is welcome. When what it says changes
 * (`resetKey`), it starts at its left edge again rather than keeping an old scroll mid-word.
 */

const FOCUSABLE = 'button:not([disabled]), a[href], input, [tabindex="0"]'

export function BandScroller({
  label,
  className,
  resetKey,
  children,
}: {
  label: string
  className?: string
  /** What the row says: a new value scrolls it back to its start. */
  resetKey?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: false, end: false })

  useLayoutEffect(() => {
    const node = ref.current
    if (!node || node.scrollLeft === 0) return
    // At once, past the row's smooth scrolling: a jump back, not a slide under the fade.
    node.scrollTo({ left: 0, behavior: 'instant' })
    setEdges((now) => ({ ...now, start: false }))
  }, [resetKey])

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = () => {
      const start = node.scrollLeft > 1
      const end = node.scrollLeft + node.clientWidth < node.scrollWidth - 1
      // The same object while neither edge changed, so a scroll inside the row renders nothing.
      setEdges((now) => (now.start === start && now.end === end ? now : { start, end }))
    }
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
    edges.start ? 'transparent, black 2.5rem' : 'black',
    edges.end ? 'black calc(100% - 2.5rem), transparent' : 'black',
  ].join(', ')
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- arrow-key roving between the focusable buttons inside; the keydown comes from them, the group is never the target
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
