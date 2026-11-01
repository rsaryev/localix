import { useEffect, useState, useSyncExternalStore } from 'react'

const noSubscription = () => () => {}
const hasObserver = () => typeof IntersectionObserver !== 'undefined'

/**
 * Whether the element is on screen. Without an observer (old browsers, tests) it reports
 * `fallback`, so content that waits for visibility is never stranded.
 */
export function useOnScreen(
  ref: React.RefObject<Element | null>,
  { margin = '0px', fallback = true }: { margin?: string; fallback?: boolean } = {},
) {
  const [onScreen, setOnScreen] = useState(false)
  // The server (and hydration) assume an observer exists, so the first render is `false` on both
  // sides; a browser without one then answers with `fallback`.
  const observable = useSyncExternalStore(noSubscription, hasObserver, () => true)
  useEffect(() => {
    const element = ref.current
    if (!element || !observable) return
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen(entry?.isIntersecting ?? false),
      { rootMargin: margin },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, margin, observable])
  return observable ? onScreen : fallback
}

/** Whether the reader asked for less motion; read only in the browser. */
export const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/**
 * Binds `--p` on the element to how far the page has scrolled through it: 0 when its top meets the
 * top of the window, 1 when its bottom meets the bottom. It is a position, never a timer, so the
 * motion plays back when the reader scrolls up. With reduced motion nothing is bound and the CSS
 * default (the finished state) stands.
 */
export function useScrollProgress(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current
    if (!element || prefersReducedMotion()) return
    let frame = 0
    const update = () => {
      frame = 0
      const box = element.getBoundingClientRect()
      const span = box.height - window.innerHeight
      const p = span > 0 ? Math.min(1, Math.max(0, -box.top / span)) : 1
      element.style.setProperty('--p', p.toFixed(4))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [ref])
}
