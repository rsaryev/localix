import type { CSSProperties } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

import type { Side } from '../../shared/rules'
import './board.css'

/**
 * A piece as a disc seen from above: a rim, a face, and one inner groove, so a man reads as a
 * checker at any size. A king carries a crown on its face — the one thing that must never be
 * mistaken, since a king moves and captures by different rules. Colours are the side's own
 * (`board.css`), fixed across themes.
 */
export function Piece({
  side,
  king,
  className,
  style,
}: {
  side: Side
  king: boolean
  className?: string
  style?: CSSProperties
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      className={cn('block size-full', `checkers-piece-${side}`, className)}
      style={style}
    >
      <circle cx="50" cy="53" r="44" fill="var(--checkers-rim)" />
      <circle
        cx="50"
        cy="48"
        r="44"
        fill="var(--checkers-fill)"
        stroke="var(--checkers-rim)"
        strokeWidth="3"
      />
      <circle
        cx="50"
        cy="48"
        r="30"
        fill="none"
        stroke="var(--checkers-rim)"
        strokeWidth="3"
        opacity="0.7"
      />
      {king && (
        // A three-point crown, drawn rather than an icon so it takes the side's crown colour.
        <path
          d="M30 60 L27 36 L40 47 L50 31 L60 47 L73 36 L70 60 Z"
          fill="var(--checkers-crown)"
          stroke="var(--checkers-rim)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}
