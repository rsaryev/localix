import { describe, expect, test } from 'bun:test'
// Radix binds its layout effect to a no-op unless a document exists while it first loads, and the
// preload holds one only while the first test file of a run loads. This file is often first in a
// pre-commit run, so it loads Radix itself, or every dialog in the DOM files after it renders nothing.
import '@localixai/kit/dialog'
import { layoutFor, listColumns } from './layout'

describe('the Store adapts to its pane', () => {
  test('wide from 1100px, medium from 760px, narrow below; wide before it is measured', () => {
    expect(layoutFor(null)).toBe('wide')
    expect(layoutFor(1400)).toBe('wide')
    expect(layoutFor(1100)).toBe('wide')
    expect(layoutFor(900)).toBe('medium')
    expect(layoutFor(760)).toBe('medium')
    expect(layoutFor(600)).toBe('narrow')
  })

  test('lists take 2–3 columns wide, 2 medium, 1 narrow', () => {
    expect(listColumns('wide', 1600)).toBe(3)
    expect(listColumns('wide', 1200)).toBe(2)
    expect(listColumns('medium', 900)).toBe(2)
    expect(listColumns('narrow', 600)).toBe(1)
  })
})
