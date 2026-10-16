import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react'

/** The page's strong ease-out, the same curve as `--ease-soft`. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const

/**
 * Motion for the homepage only: the DOM feature bundle loads with the page, and `reducedMotion`
 * follows the visitor's setting so transforms drop out while opacity changes stay.
 */
export function HomeMotion({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  )
}

/** A media query as state. The server and the first client render answer `false`. */
export function useMedia(query: string) {
  return useSyncExternalStore(
    (listener) => {
      const media = window.matchMedia(query)
      media.addEventListener('change', listener)
      return () => media.removeEventListener('change', listener)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** Fine pointer, room for the effect, and no reduced-motion request. */
export const RICH_MOTION =
  '(min-width: 48rem) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)'

/**
 * Whether the element is on screen. Without an observer (old browsers, tests) it reports
 * `fallback`, so content that waits for visibility is never stranded.
 */
export function useOnScreen(
  ref: React.RefObject<Element | null>,
  { margin = '0px', fallback = true }: { margin?: string; fallback?: boolean } = {},
) {
  const [onScreen, setOnScreen] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (typeof IntersectionObserver === 'undefined') {
      setOnScreen(fallback)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen(entry?.isIntersecting ?? false),
      { rootMargin: margin },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, margin, fallback])
  return onScreen
}
