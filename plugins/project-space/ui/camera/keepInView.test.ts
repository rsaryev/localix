import { describe, expect, test } from 'bun:test'
import { focusViewport } from './framing'
import { keepInView } from './keepInView'

const SIZE = { width: 1000, height: 800 }
const AT_ORIGIN = { x: 0, y: 0, zoom: 1 }

describe('a deliberate focus', () => {
  const card = { x: 100, y: 100, w: 200, h: 150 }

  test('brings a card seen from afar to a reading size', () => {
    const far = { x: 0, y: 0, zoom: 0.3 }
    expect(focusViewport(card, 'one', far, SIZE)?.zoom).toBeGreaterThan(1)
  })

  test('from a view already that close, keeps the zoom and brings the card to the middle', () => {
    // A neighbour in plain view at 2.2×: the camera still moves, so it centres.
    const close = { x: -150, y: -100, zoom: 2.2 }
    const moved = focusViewport(card, 'one', close, SIZE)
    expect(moved?.zoom).toBe(2.2)
    // The card's centre (200, 175) lands on the view's centre (500, 400).
    expect(200 * 2.2 + (moved?.x ?? 0)).toBeCloseTo(500)
    expect(175 * 2.2 + (moved?.y ?? 0)).toBeCloseTo(400)
  })

  test('a card already about in the middle moves nothing', () => {
    const centred = { x: 500 - 200 * 2, y: 400 - 175 * 2, zoom: 2 }
    expect(focusViewport(card, 'one', { ...centred, x: centred.x + 10 }, SIZE)).toBeNull()
  })
})

describe('keeping the focus in view', () => {
  test('a focus already in view does not move the camera', () => {
    expect(keepInView({ x: 100, y: 100, w: 200, h: 200 }, AT_ORIGIN, SIZE, 48)).toBeNull()
  })

  test('one partly off screen slides in just far enough, at the zoom it has', () => {
    const moved = keepInView({ x: 900, y: 100, w: 200, h: 200 }, AT_ORIGIN, SIZE, 48)
    // Its right edge (1100) comes to 1000 − 48: a slide of −148, y untouched.
    expect(moved).toEqual({ x: -148, y: 0, zoom: 1 })
    const above = keepInView({ x: 100, y: -300, w: 200, h: 200 }, AT_ORIGIN, SIZE, 48)
    expect(above).toEqual({ x: 0, y: 348, zoom: 1 })
  })

  test('only a focus larger than the view zooms out, to fit it whole', () => {
    const huge = keepInView({ x: 0, y: 0, w: 3000, h: 400 }, AT_ORIGIN, SIZE, 48)
    expect(huge?.zoom).toBeLessThan(1)
  })
})
