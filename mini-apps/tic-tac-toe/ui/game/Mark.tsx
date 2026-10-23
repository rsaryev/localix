import type { CSSProperties } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

import type { Mark as MarkValue } from '../../shared/game'
import './board.css'

/**
 * X and O as strokes, so a new one can be drawn in (see `board.css`). Coloured by PLAYER, not by
 * meaning — a status colour would say "success" or "error" about a move — so the two marks take two
 * chart series, which the theme tunes for contrast on light and dark alike.
 *
 * Optically balanced rather than equal: an X's bounding box reads smaller than a ring of the same
 * box, so the X spans 42 of the 100 units and the ring's outer edge about 51, with one stroke
 * weight for both.
 */
export const MARK_TONE: Record<MarkValue, string> = {
  X: 'text-(--chart-2)',
  O: 'text-(--chart-1)',
}

const STROKE = 7.5

export function Mark({
  mark,
  drawn = false,
  order = 0,
  className,
  style,
}: {
  mark: MarkValue
  /** Animate the strokes in — only for a mark that has just arrived. */
  drawn?: boolean
  /** Its place among the marks that arrived together; each waits for the one before. */
  order?: number
  className?: string
  style?: CSSProperties
}) {
  const delay = drawn
    ? ({ '--tic-tac-toe-delay': `calc(var(--dur-moderate) * ${order})` } as CSSProperties)
    : undefined
  const stroke = drawn ? 'tic-tac-toe-stroke' : undefined
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinecap="round"
      className={cn('block size-full', MARK_TONE[mark], className)}
      style={{ ...delay, ...style }}
    >
      {drawn && (
        <circle
          cx="50"
          cy="50"
          r="34"
          fill="currentColor"
          stroke="none"
          className="tic-tac-toe-ripple"
        />
      )}
      {mark === 'X' ? (
        <>
          <line x1="29" y1="29" x2="71" y2="71" pathLength={100} className={stroke} />
          <line
            x1="71"
            y1="29"
            x2="29"
            y2="71"
            pathLength={100}
            className={cn(stroke, drawn && 'tic-tac-toe-stroke-second')}
          />
        </>
      ) : (
        // Rotated so the stroke starts at twelve o'clock, where a hand would start it.
        <circle
          cx="50"
          cy="50"
          r="22"
          transform="rotate(-90 50 50)"
          pathLength={100}
          className={stroke}
        />
      )}
    </svg>
  )
}
