import { describe, expect, test } from 'bun:test'
import { snapBox } from './snap'

const other = { x: 0, y: 0, w: 100, h: 100 }

describe('snapping a dragged box', () => {
  test('the nearest edge or centre within the threshold wins, each axis on its own', () => {
    // On y its top (46) is 4 from the other's centre (50); on x nothing is within 8.
    const snap = snapBox({ x: 205, y: 46, w: 100, h: 100 }, [other], 8)
    expect(snap).toMatchObject({ dx: 0, dy: 4 })
  })

  test('the guide runs from the far side of the matched box to the far side of the selection', () => {
    const { guides } = snapBox({ x: 300, y: 3, w: 50, h: 50 }, [other], 8)
    expect(guides).toContainEqual({ axis: 'y', at: 0, from: 0, to: 350 })
  })

  test('outside the threshold nothing moves and no guide is drawn', () => {
    expect(snapBox({ x: 300, y: 300, w: 50, h: 40 }, [other], 8)).toEqual({
      dx: 0,
      dy: 0,
      guides: [],
    })
  })
})
