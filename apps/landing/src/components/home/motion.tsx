import { useEffect, useState, type ReactNode } from 'react'
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react'

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
