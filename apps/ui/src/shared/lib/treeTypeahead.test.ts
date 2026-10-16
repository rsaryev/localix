import { describe, expect, test } from 'bun:test'
import { createTypeahead, type TypeaheadRow } from '@localixai/kit/tree-navigation'

const row = (path: string, name?: string): TypeaheadRow => ({
  path,
  name: name ?? (path.split('/').pop() || path),
})

const ROWS = [
  row('src'),
  row('src/apple.ts'),
  row('src/avocado.ts'),
  row('src/banana.ts'),
  row('src/apricot.ts'),
]

/** Typeahead with a manual clock. */
function make() {
  let t = 0
  const ta = createTypeahead({ now: () => t })
  return { ta, tick: (ms: number) => (t += ms) }
}

describe('createTypeahead', () => {
  test('jumps to the next row whose name starts with the char, wrapping around', () => {
    const { ta } = make()
    expect(ta.handleChar('b', ROWS, 'src')).toBe('src/banana.ts')
    // From the last row, 's' wraps to the top.
    const t2 = make().ta
    expect(t2.handleChar('s', ROWS, 'src/apricot.ts')).toBe('src')
  })

  test('accumulates a multi-char prefix within the timeout', () => {
    const { ta, tick } = make()
    expect(ta.handleChar('a', ROWS, 'src')).toBe('src/apple.ts')
    tick(100)
    expect(ta.handleChar('v', ROWS, 'src/apple.ts')).toBe('src/avocado.ts')
    tick(100)
    // 'avo' still matches avocado — a multi-char prefix keeps the current row
    // as the last candidate, so focus stays put while the prefix extends.
    expect(ta.handleChar('o', ROWS, 'src/avocado.ts')).toBe('src/avocado.ts')
  })

  test('buffer resets after the timeout', () => {
    const { ta, tick } = make()
    expect(ta.handleChar('a', ROWS, 'src')).toBe('src/apple.ts')
    tick(601)
    // A fresh 'b' is NOT 'ab' — it starts a new prefix.
    expect(ta.handleChar('b', ROWS, 'src/apple.ts')).toBe('src/banana.ts')
  })

  test('repeating the same single char cycles through its matches', () => {
    const { ta, tick } = make()
    expect(ta.handleChar('a', ROWS, 'src')).toBe('src/apple.ts')
    tick(100)
    expect(ta.handleChar('a', ROWS, 'src/apple.ts')).toBe('src/avocado.ts')
    tick(100)
    expect(ta.handleChar('a', ROWS, 'src/avocado.ts')).toBe('src/apricot.ts')
    tick(100)
    // Wraps back to the first 'a' row, never re-landing on the current one.
    expect(ta.handleChar('a', ROWS, 'src/apricot.ts')).toBe('src/apple.ts')
  })

  test('no match returns null', () => {
    const { ta, tick } = make()
    expect(ta.handleChar('z', ROWS, 'src')).toBeNull()
    tick(100)
    // Dead prefix stays dead while accumulating.
    expect(ta.handleChar('a', ROWS, 'src')).toBeNull()
    expect(ta.handleChar('x', [], null)).toBeNull()
  })

  test('matching is case-insensitive both ways', () => {
    const { ta } = make()
    const rows = [row('Readme.MD', 'Readme.MD'), row('lib')]
    expect(ta.handleChar('r', rows, 'lib')).toBe('Readme.MD')
    const { ta: ta2 } = make()
    expect(ta2.handleChar('L', rows, 'Readme.MD')).toBe('lib')
  })

  test('reset drops the accumulated buffer', () => {
    const { ta, tick } = make()
    ta.handleChar('a', ROWS, 'src')
    tick(100)
    ta.reset()
    // 'v' alone matches nothing (would have matched 'av' as avocado's prefix
    // continuation only if the buffer survived).
    expect(ta.handleChar('v', ROWS, 'src/apple.ts')).toBeNull()
  })

  test('single char never sticks on the current row even when it matches', () => {
    const { ta } = make()
    expect(ta.handleChar('a', ROWS, 'src/apple.ts')).toBe('src/avocado.ts')
  })
})
