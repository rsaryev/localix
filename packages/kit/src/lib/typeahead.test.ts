import { describe, expect, test } from 'bun:test'
import { createTypeaheadBuffer } from './typeahead'

const LABELS = ['Apple', 'Avocado', 'Banana', 'Apricot']

describe('createTypeaheadBuffer', () => {
  test('a single character advances past the current entry and cycles on repeat', () => {
    let t = 0
    const buffer = createTypeaheadBuffer({ timeoutMs: 500, now: () => t })
    expect(buffer.handleChar('a', LABELS, 0)).toBe(1)
    t += 100
    expect(buffer.handleChar('a', LABELS, 1)).toBe(3)
    t += 100
    expect(buffer.handleChar('a', LABELS, 3)).toBe(0)
  })

  test('an extended prefix keeps a still-matching current entry', () => {
    let t = 0
    const buffer = createTypeaheadBuffer({ timeoutMs: 500, now: () => t })
    // 'Ap' matches Apple (current) and Apricot: the current entry keeps its place.
    expect(buffer.handleChar('a', LABELS, -1)).toBe(0)
    t += 100
    expect(buffer.handleChar('p', LABELS, 0)).toBe(0)
    t += 100
    expect(buffer.handleChar('r', LABELS, 0)).toBe(3)
  })

  test('the prefix expires after the timeout and reset drops it', () => {
    let t = 0
    const buffer = createTypeaheadBuffer({ timeoutMs: 500, now: () => t })
    expect(buffer.handleChar('b', LABELS, -1)).toBe(2)
    t += 600
    expect(buffer.handleChar('a', LABELS, 2)).toBe(3)
    buffer.reset()
    expect(buffer.handleChar('z', LABELS, 0)).toBe(-1)
    expect(buffer.handleChar('a', [], -1)).toBe(-1)
  })
})
