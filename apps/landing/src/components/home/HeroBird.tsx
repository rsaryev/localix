import { useEffect, useRef, useSyncExternalStore } from 'react'
import { BirdStage } from '@ui/shared/ui/BirdStage'

const desktopQuery = '(min-width: 64rem)'

function subscribeDesktop(listener: () => void) {
  const media = window.matchMedia(desktopQuery)
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}

function subscribeReducedMotion(listener: () => void) {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}

/**
 * The hero's moving bird, mounted after the first paint (see `AfterFirstPaint`).
 *
 * It flies for as long as it is on screen. A fixed number of passes ended with the wind held
 * invisible and the bird at rest, and nothing replayed it, so after a few seconds the hero looked
 * broken until the page was reloaded. What cost the idle compositor time was never the looping
 * itself but animating while nobody could see it, so the wrapper pauses every animation while the
 * hero is scrolled away or the tab is hidden and resumes them when it is back. With reduced motion
 * requested it is the bird alone, no wind.
 */
export function HeroBird() {
  const desktop = useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(desktopQuery).matches,
    () => false,
  )
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  )
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element || reduced) return
    let onScreen = true
    const apply = () => {
      element.dataset.paused = String(!onScreen || document.hidden)
    }
    apply()
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true
      apply()
    })
    observer.observe(element.closest('.hero-layout') ?? element)
    document.addEventListener('visibilitychange', apply)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', apply)
    }
  }, [reduced])

  return (
    <div ref={ref} className="hero-bird w-full h-full">
      <BirdStage
        maskUrl="/logo.svg"
        stageClassName="h-full w-full"
        birdClassName="hero-bird-logo"
        windClassName={reduced ? 'hidden' : 'hero-bird-wind opacity-100'}
        windRight={desktop ? '25%' : '15%'}
        windIntensity={desktop ? 1.2 : 1.4}
        lineCount={reduced ? 0 : desktop ? 12 : 8}
        spread={desktop ? 150 : 260}
        cycles={reduced ? 1 : Infinity}
      />
    </div>
  )
}
