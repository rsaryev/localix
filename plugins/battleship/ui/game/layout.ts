import { useEffect, useState, type RefObject } from 'react'

/**
 * How big the two boards can be in the pane they are given — measured, not guessed.
 *
 * The defect this replaces: the boards were capped at a fixed width (52rem), so in a large pane
 * they sat small in the middle of empty space. A board is ten cells and a label on each axis; what
 * matters is the CELL, so the pane is measured and the cell is the largest that fits the pair SIDE
 * BY SIDE — the classic table, your target on the left and your fleet on the right. Sizing by a
 * CSS size container was not an option: a size container whose host gives it no definite height
 * collapses to nothing.
 */

/** Gap between the two boards, the label column, and the room each board's heading takes. */
export const BOARD_GAP = 40
export const LABEL = 22
export const HEADING = 34
/**
 * The control row above the pair — the same place Tic-Tac-Toe and Checkers put theirs. Its status
 * is two fixed lines and problems float over the boards, so the row needs no room to grow.
 */
export const STATUS_ROW = 60
/** A cell never shrinks below a tap target, nor grows past where a board stops reading as one. */
export const MIN_CELL = 22
export const MAX_CELL = 60

/** One board's extent for a cell size: the label plus ten cells, on each axis. */
const extent = (cell: number) => LABEL + cell * 10

/** The largest cell that fits the two boards side by side in `width` × `height`. */
export function fitBoards(width: number, height: number): number {
  const cell = Math.min(
    (width - BOARD_GAP - 2 * LABEL) / 20,
    (height - STATUS_ROW - HEADING - LABEL) / 10,
  )
  return Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor(cell)))
}

/** The pixel width of the pair of boards side by side at `cell`. */
export const pairWidth = (cell: number) => 2 * extent(cell) + BOARD_GAP

/** The cell size for the element `ref` points at, re-measured whenever it resizes. */
export function useBoardLayout(ref: RefObject<HTMLElement | null>): number {
  const [cell, setCell] = useState(36)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const { width, height } = element.getBoundingClientRect()
      if (width > 0 && height > 0) setCell(fitBoards(width, height))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return cell
}
