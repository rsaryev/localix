import { useEffect, useState, useSyncExternalStore } from 'react'
import * as m from 'motion/react-m'
import { useScroll, useSpring, useTransform, type MotionValue } from 'motion/react'
import { ProductShot } from '../ProductShot'
import { cn } from '../../lib/cn'
import { RICH_MOTION, useMedia } from './motion'

/** How far the page scrolls, in viewport heights, before the stack lies flat (`home.css` too). */
const FLATTEN_DISTANCE = 0.7

/** Scroll-driven CSS runs on the compositor; where it exists, the stylesheet does the flattening. */
function useNativeScrollTimeline() {
  return useSyncExternalStore(
    () => () => {},
    () => typeof CSS !== 'undefined' && CSS.supports('animation-timeline: scroll()'),
    () => false,
  )
}

function useFlatten() {
  const { scrollY } = useScroll()
  const [distance, setDistance] = useState(600)
  useEffect(() => {
    const measure = () => setDistance(Math.max(320, window.innerHeight * FLATTEN_DISTANCE))
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  const raw = useTransform(scrollY, [0, distance], [0, 1], { clamp: true })
  return useSpring(raw, { stiffness: 160, damping: 32, mass: 0.5, restDelta: 0.0005 })
}

function usePanelStyle(progress: MotionValue<number>, from: string, to: string, fade = false) {
  return {
    x: useTransform(progress, [0, 1], [from, to]),
    rotate: useTransform(progress, [0, 1], [-24, 0]),
    skewY: useTransform(progress, [0, 1], [12, 0]),
    opacity: useTransform(progress, [0, 0.75], fade ? [1, 0] : [1, 1]),
  }
}

/**
 * Adapted from Launch UI's publicly rendered Pro hero, not its unavailable React source.
 * https://www.launchuicomponents.com/docs/sections/hero
 * The three panels keep its stacking order, rotation and skew at rest. Scrolling the first
 * viewport lays the stack flat: the side captures slide away and the workspace capture settles
 * full width, so the first scroll reveals the product instead of moving past it. Browsers with
 * scroll-driven animations get it from CSS, off the main thread; the others follow the scroll in
 * Motion with a light spring. Without a fine pointer, room, or motion, the stylesheet's resting
 * layout is all there is.
 */
export function ProductShowcase({ className }: { className?: string }) {
  const native = useNativeScrollTimeline()
  const rich = useMedia(RICH_MOTION) && !native
  const progress = useFlatten()
  const left = usePanelStyle(progress, '-24%', '-72%', true)
  const middle = usePanelStyle(progress, '0%', '-18%', true)
  const main = usePanelStyle(progress, '32%', '0%')
  const fade = useTransform(progress, [0, 0.8], [1, 0])
  const glow = useTransform(progress, [0.3, 1], [0, 1])

  return (
    <div
      className={cn('product-showcase', className)}
      data-motion={rich ? 'script' : native ? 'timeline' : undefined}
    >
      <m.div className="showcase-glow" aria-hidden="true" style={rich ? { opacity: glow } : {}} />
      <div className="showcase-stack">
        <m.div
          className="showcase-panel showcase-side showcase-left"
          aria-hidden="true"
          style={rich ? left : undefined}
        >
          <ProductShot shot="project-space/board" alt="" className="rounded-md border-0" />
        </m.div>
        <m.div
          className="showcase-panel showcase-side showcase-middle"
          aria-hidden="true"
          style={rich ? middle : undefined}
        >
          <ProductShot shot="task-board/board" alt="" className="rounded-md border-0" />
        </m.div>
        <m.div className="showcase-panel showcase-main" style={rich ? main : undefined}>
          <ProductShot
            shot="workspace/hero"
            alt="Localix workspace: source editor, terminal test results, and a shared agent conversation"
            priority
            className="rounded-md border-0"
          />
        </m.div>
      </div>
      <m.div className="showcase-fade" aria-hidden="true" style={rich ? { opacity: fade } : {}} />
    </div>
  )
}
