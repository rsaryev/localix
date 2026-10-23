import type { CSSProperties } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

import './board.css'

/**
 * A small burst for a game the person won, from the middle of the board. Once, and only when the
 * win happens in front of them (the board decides that); `board.css` removes it for a person who
 * asked for reduced motion. Colours are chart series, written out for the stylesheet.
 */

const COUNT = 18
const TONES = ['bg-(--chart-2)', 'bg-(--chart-5)', 'bg-(--chart-6)', 'bg-(--chart-4)']

/** Evenly around the circle, at two alternating reaches, so the burst is round but not rigid. */
const SPARKS = Array.from({ length: COUNT }, (_, index) => {
  const angle = (index / COUNT) * Math.PI * 2 + (index % 2) * 0.17
  const reach = index % 2 === 0 ? 120 : 84
  return {
    tone: TONES[index % TONES.length]!,
    dx: `${Math.round(Math.cos(angle) * reach)}px`,
    dy: `${Math.round(Math.sin(angle) * reach)}px`,
  }
})

export function Sparks() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {SPARKS.map((spark, index) => (
        <span
          key={index}
          className={cn('checkers-spark absolute size-1.5 rounded-xs', spark.tone)}
          style={{ left: '50%', top: '50%', '--dx': spark.dx, '--dy': spark.dy } as CSSProperties}
        />
      ))}
    </div>
  )
}
