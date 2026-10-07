import { useEffect, useRef } from 'react'
import { BirdStage } from '@ui/shared/ui/BirdStage'

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
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element || reduced) return
    let onScreen = true
    const apply = () => {
      element.dataset.paused = String(!onScreen || document.hidden)
    }
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true
      apply()
    })
    observer.observe(element)
    document.addEventListener('visibilitychange', apply)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', apply)
    }
  }, [reduced])

  return (
    <div
      ref={ref}
      className="hero-bird w-full [mask-image:linear-gradient(to_right,transparent,black_42%)]"
    >
      <BirdStage
        maskUrl="/logo.svg"
        stageClassName="h-96 w-full xl:h-[30rem]"
        birdClassName="size-28 lg:size-36"
        windClassName={reduced ? 'hidden' : 'opacity-100'}
        windRight="25%"
        windIntensity={0.4}
        lineCount={reduced ? 0 : 12}
        spread={260}
        cycles={reduced ? 1 : Infinity}
      />
    </div>
  )
}
