import { cn } from '@localixai/mini-app-sdk/ui/classes'

import type { Side } from '../../shared/position'
import './board.css'

/**
 * A piece as its chess glyph, filled with its side's colour and outlined in the other's
 * (`board.css`), so it reads on either square in either theme. The glyphs are the solid set for
 * both sides — the outlined "white" glyphs vanish on a light square — and every one carries the
 * text-presentation selector (U+FE0E): without it the black pawn renders as an emoji on macOS.
 */
const GLYPH: Record<string, string> = {
  k: '♚',
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
  p: '♟',
}

export function Piece({ side, type, className }: { side: Side; type: string; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('chess-piece', `chess-piece-${side}`, className)}>
      {`${GLYPH[type] ?? ''}︎`}
    </span>
  )
}
