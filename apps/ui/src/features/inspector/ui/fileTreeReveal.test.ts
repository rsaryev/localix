import { describe, expect, test } from 'bun:test'
import { revealScrollIndex } from './fileTreeReveal'

const index = (map: Record<string, number>) => (path: string) => map[path]

describe('revealScrollIndex', () => {
  test('serves a mapped request once', () => {
    const request = { path: '/w/a.ts', intent: 3 }
    const at = index({ '/w/a.ts': 12 })
    expect(revealScrollIndex(request, null, at)).toBe(12)
    // Same intent, already served — every later row-model change must leave the scroll alone.
    expect(revealScrollIndex(request, 3, at)).toBeNull()
  })

  test('retries while the path has no row yet', () => {
    const request = { path: '/w/deep/a.ts', intent: 1 }
    // Ancestors still loading: unmapped, so the intent stays unrecorded…
    expect(revealScrollIndex(request, null, index({}))).toBeNull()
    // …and the reveal still lands once the row model catches up.
    expect(revealScrollIndex(request, null, index({ '/w/deep/a.ts': 7 }))).toBe(7)
  })

  test('a fresh intent for the same path scrolls again', () => {
    const at = index({ '/w/a.ts': 4 })
    expect(revealScrollIndex({ path: '/w/a.ts', intent: 9 }, 8, at)).toBe(4)
  })

  test('no request, no scroll', () => {
    expect(revealScrollIndex(null, 2, index({ '/w/a.ts': 4 }))).toBeNull()
  })

  test('index 0 is a real target, not a falsy miss', () => {
    expect(revealScrollIndex({ path: '/w/a.ts', intent: 1 }, null, index({ '/w/a.ts': 0 }))).toBe(0)
  })
})
