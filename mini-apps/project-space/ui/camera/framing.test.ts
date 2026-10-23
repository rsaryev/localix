import { describe, expect, test } from 'bun:test'
import { frameViewport, selectionViewport } from './framing'

const VIEW = { width: 1000, height: 800 }
const note = { x: 0, y: 0, w: 200, h: 200 }
const region = { x: 0, y: 0, w: 4000, h: 2000 }

describe('how close the camera comes', () => {
  test('ONE element comes to a reading size — past 100 %, up to 125 % — not a plain fit', () => {
    expect(frameViewport(note, VIEW, 'one').zoom).toBeCloseTo(1.25)
    // A plain region fit never enlarges past 100 %.
    expect(frameViewport(note, VIEW, 'many').zoom).toBe(1)
    // A wide one fills the middle half of the view, its neighbours still in sight.
    const big = { x: 0, y: 0, w: 1400, h: 400 }
    expect(frameViewport(big, VIEW, 'one').zoom).toBeCloseTo((1000 * 0.5) / 1400)
  })

  test('a zoom the caller names wins, centred on what is framed', () => {
    const viewport = frameViewport(note, VIEW, 'one', 0.5)
    expect(viewport.zoom).toBe(0.5)
    // The note's centre (100, 100) lands on the view's centre (500, 400).
    expect(100 * viewport.zoom + viewport.x).toBeCloseTo(500)
    expect(100 * viewport.zoom + viewport.y).toBeCloseTo(400)
  })

  test('zoom to selection: 100 % first, then — pressed at 100 % — the whole selection', () => {
    const away = { x: 0, y: 0, zoom: 0.4 }
    expect(selectionViewport(note, VIEW, away).zoom).toBe(1)
    expect(selectionViewport(region, VIEW, away).zoom).toBeLessThan(1)
    const atHundred = { x: 0, y: 0, zoom: 1 }
    expect(selectionViewport(note, VIEW, atHundred).zoom).toBeGreaterThan(1)
  })
})
