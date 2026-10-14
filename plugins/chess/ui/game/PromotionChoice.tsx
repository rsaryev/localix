import { useEffect, useRef, type KeyboardEvent } from 'react'
import { Button } from '@localixai/kit/button'

import type { Promotion, Side } from '../../shared/position'
import { Piece } from './Piece'

/**
 * Which piece a pawn becomes on the last rank — asked over the board, the queen first and focused,
 * because it is the choice nearly every time. Escape (or the cancel) keeps the pawn where it was.
 */
const CHOICES: { piece: Promotion; name: string }[] = [
  { piece: 'q', name: 'Queen' },
  { piece: 'r', name: 'Rook' },
  { piece: 'b', name: 'Bishop' },
  { piece: 'n', name: 'Knight' },
]

export function PromotionChoice({
  side,
  onChoose,
  onCancel,
}: {
  side: Side
  onChoose: (piece: Promotion) => void
  onCancel: () => void
}) {
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => first.current?.focus(), [])
  // Escape on any of the buttons — focus is always on one of them — keeps the pawn.
  const cancelOnEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') onCancel()
  }
  return (
    <div className="absolute inset-0 z-(--z-raised) flex items-center justify-center">
      <div
        role="dialog"
        aria-label="Promote the pawn to"
        className="chess-promote flex flex-col items-center gap-2 rounded-xl border border-border-soft bg-popover/90 px-4 py-3 shadow-(--shadow-popover) backdrop-blur-md"
      >
        <p className="text-xs text-text-soft">Promote the pawn to</p>
        <div className="flex gap-1">
          {CHOICES.map(({ piece, name }, index) => (
            <Button
              key={piece}
              ref={index === 0 ? first : undefined}
              variant="ghost"
              aria-label={name}
              className="size-14"
              onClick={() => onChoose(piece)}
              onKeyDown={cancelOnEscape}
            >
              <Piece side={side} type={piece} />
            </Button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={onCancel} onKeyDown={cancelOnEscape}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
