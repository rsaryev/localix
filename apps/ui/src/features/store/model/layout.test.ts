import { describe, expect, test } from 'bun:test'
import { layoutFor, listColumns, tilesPerView } from './layout'

describe('the Store adapts to its pane', () => {
  test('wide from 1100px, medium from 760px, narrow below; wide before it is measured', () => {
    expect(layoutFor(null)).toBe('wide')
    expect(layoutFor(1400)).toBe('wide')
    expect(layoutFor(1100)).toBe('wide')
    expect(layoutFor(900)).toBe('medium')
    expect(layoutFor(760)).toBe('medium')
    expect(layoutFor(600)).toBe('narrow')
  })

  test('rows hold 4–5 tiles wide, 3 medium, and peek at the next one narrow', () => {
    expect(tilesPerView('wide', 1400)).toBe(5)
    expect(tilesPerView('wide', 1150)).toBe(4)
    expect(tilesPerView('medium', 900)).toBe(3)
    expect(tilesPerView('narrow', 600) % 1).toBeGreaterThan(0)
  })

  test('lists take 2–3 columns wide, 2 medium, 1 narrow', () => {
    expect(listColumns('wide', 1600)).toBe(3)
    expect(listColumns('wide', 1200)).toBe(2)
    expect(listColumns('medium', 900)).toBe(2)
    expect(listColumns('narrow', 600)).toBe(1)
  })
})
