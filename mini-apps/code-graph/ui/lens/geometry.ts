import type { CodeCard } from '../../shared/lens'

/**
 * The measures a code card is laid out in. One place, because three things must agree on them:
 * the card's own rows, the handle each call line's edge leaves from, and the lens layout that
 * places cards and the tiles beside them.
 */
export const CARD = {
  header: 40,
  line: 18,
  padY: 8,
  footer: 26,
  /** Width of one monospace cell at the card's type size, for sizing before the DOM measures. */
  cell: 6.8,
  minWidth: 380,
  maxWidth: 760,
}

export function gutterCells(card: CodeCard): number {
  return String(card.startLine + card.lines.length - 1).length + 2
}

export function cardSize(card: CodeCard): { width: number; height: number } {
  const longest = card.lines.reduce((max, line) => Math.max(max, line.length), 0)
  const width = Math.round((gutterCells(card) + longest + 2) * CARD.cell + 24)
  return {
    width: Math.min(CARD.maxWidth, Math.max(CARD.minWidth, width)),
    height:
      CARD.header +
      CARD.padY * 2 +
      card.lines.length * CARD.line +
      (card.truncated ? CARD.footer : 0),
  }
}

/** The vertical centre of a source line, from the top of the card. */
export function lineY(card: CodeCard, line: number): number {
  return CARD.header + CARD.padY + (line - card.startLine) * CARD.line + CARD.line / 2
}

export const lineHandle = (line: number) => `line-${line}`
export const IN_HANDLE = 'in'
