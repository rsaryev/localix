import { describe, expect, test } from 'bun:test'
import { flight } from './flight'

const SIZE = { width: 1000, height: 800 }

describe('the camera’s flight', () => {
  test('starts exactly where it is and lands exactly where it was sent', () => {
    const from = { x: 0, y: 0, zoom: 1 }
    const to = { x: -4000, y: -2500, zoom: 1.2 }
    const trip = flight(from, to, SIZE)
    expect(trip.at(0)).toEqual(from)
    expect(trip.at(1)).toEqual(to)
  })

  test('a far flight rises mid-way — the swing — and a near one barely does', () => {
    const from = { x: 0, y: 0, zoom: 1 }
    const far = flight(from, { x: -8000, y: 0, zoom: 1 }, SIZE)
    expect(far.at(0.5).zoom).toBeLessThan(0.5)
    const near = flight(from, { x: -100, y: 0, zoom: 1 }, SIZE)
    expect(near.at(0.5).zoom).toBeGreaterThan(0.95)
  })

  test('is never a flicker nor a wait, and a longer trip takes longer', () => {
    const from = { x: 0, y: 0, zoom: 1 }
    const short = flight(from, { x: -50, y: 0, zoom: 1 }, SIZE).durationMs
    const long = flight(from, { x: -20000, y: 0, zoom: 1 }, SIZE).durationMs
    expect(short).toBeGreaterThanOrEqual(320)
    expect(long).toBeLessThanOrEqual(1100)
    expect(long).toBeGreaterThan(short)
  })

  test('a pure zoom stays put and only changes how close', () => {
    const from = { x: 500 - 100, y: 400 - 100, zoom: 1 }
    const trip = flight(from, { x: 500 - 200, y: 400 - 200, zoom: 2 }, SIZE)
    const mid = trip.at(0.5)
    // The board point at the centre (100, 100) stays at the centre throughout.
    expect((500 - mid.x) / mid.zoom).toBeCloseTo(100)
    expect((400 - mid.y) / mid.zoom).toBeCloseTo(100)
  })
})
