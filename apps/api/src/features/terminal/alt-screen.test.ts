import { describe, expect, test } from 'bun:test'
import { createAltScreenTracker } from './alt-screen'

const ENTER_1049 = '\x1b[?1049h'
const LEAVE_1049 = '\x1b[?1049l'

describe('createAltScreenTracker', () => {
  test('starts on the primary screen', () => {
    expect(createAltScreenTracker().altScreen).toBe(false)
  })

  test('enter/leave via 1049 (modern full-screen apps)', () => {
    const t = createAltScreenTracker()
    expect(t.push(`hello ${ENTER_1049}app painting`)).toBe(true)
    expect(t.push(`bye ${LEAVE_1049}$ `)).toBe(false)
  })

  test('legacy variants 1047 and 47 are recognized', () => {
    const t = createAltScreenTracker()
    expect(t.push('\x1b[?1047h')).toBe(true)
    expect(t.push('\x1b[?1047l')).toBe(false)
    expect(t.push('\x1b[?47h')).toBe(true)
    expect(t.push('\x1b[?47l')).toBe(false)
  })

  test('the LAST switch in a chunk wins (vim opened and quit in one burst)', () => {
    const t = createAltScreenTracker()
    expect(t.push(`${ENTER_1049}…session…${LEAVE_1049}`)).toBe(false)
  })

  test('sequence split across chunk boundaries is still detected', () => {
    const t = createAltScreenTracker()
    t.push('output \x1b[?10')
    expect(t.altScreen).toBe(false) // incomplete — not yet
    expect(t.push('49h painted')).toBe(true)
    t.push('\x1b')
    t.push('[?1049')
    expect(t.push('l')).toBe(false)
  })

  test('carry overlap never double-flips state', () => {
    const t = createAltScreenTracker()
    t.push(ENTER_1049) // whole sequence sits inside the carry tail afterwards
    expect(t.push('')).toBe(true) // re-scan of the carry re-applies enter — same state
    expect(t.push('x')).toBe(true)
  })

  test('similar-looking sequences do not trigger (cursor keys, other DECSET)', () => {
    const t = createAltScreenTracker()
    expect(t.push('\x1b[?25h\x1b[?2004h\x1b[H\x1b[2J')).toBe(false) // cursor show, bracketed paste, clears
    expect(t.push('plain text ?1049h without ESC')).toBe(false)
  })
})
