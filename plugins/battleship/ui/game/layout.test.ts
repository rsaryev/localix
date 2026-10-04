import { describe, expect, test } from 'bun:test'

import { HEADING, LABEL, MAX_CELL, MIN_CELL, STATUS_ROW, fitBoards, pairWidth } from './layout'

describe('fitting the two boards side by side in the pane', () => {
  test('the pair always fits the space it was measured in', () => {
    for (const [width, height] of [
      [1000, 1100],
      [760, 520],
      [1400, 700],
      [640, 900],
    ] as const) {
      const cell = fitBoards(width, height)
      if (cell > MIN_CELL) {
        expect(pairWidth(cell)).toBeLessThanOrEqual(width)
        expect(STATUS_ROW + HEADING + LABEL + cell * 10).toBeLessThanOrEqual(height)
      }
    }
  })

  test('the pane in the report — about 950 × 1060 — gets larger tiles than the old fixed 36px', () => {
    expect(fitBoards(952, 1060)).toBeGreaterThan(40)
  })

  test('a tile stays between a tap target and a size that still reads as a board', () => {
    expect(fitBoards(200, 200)).toBe(MIN_CELL)
    expect(fitBoards(4000, 4000)).toBe(MAX_CELL)
  })
})
