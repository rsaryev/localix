import { describe, expect, test } from 'bun:test'

import { readerSelectionToolbarPosition, type ReaderRect } from './selection'

const rect = (left: number, top: number, width: number, height: number): ReaderRect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
})

describe('reader selection toolbar geometry', () => {
  test('anchors above the active line and clamps against horizontal edges', () => {
    const surface = rect(100, 50, 600, 700)
    expect(
      readerSelectionToolbarPosition(rect(350, 400, 120, 24), surface, { width: 300, height: 40 }),
    ).toEqual({ left: 160, top: 300, arrowLeft: 150, placement: 'above' })

    expect(
      readerSelectionToolbarPosition(rect(104, 400, 20, 24), surface, { width: 300, height: 40 }),
    ).toEqual({ left: 8, top: 300, arrowLeft: 12, placement: 'above' })
  })

  test('moves below a selection near the top without escaping the surface', () => {
    expect(
      readerSelectionToolbarPosition(rect(260, 58, 80, 22), rect(100, 50, 400, 240), {
        width: 360,
        height: 80,
      }),
    ).toEqual({ left: 20, top: 40, arrowLeft: 180, placement: 'below' })
  })
})
