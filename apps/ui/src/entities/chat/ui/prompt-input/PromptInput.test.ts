import { expect, test } from 'bun:test'

import { nextCaretInText } from './caretInText'

/**
 * Caret reporting fires from five textarea events, several per keystroke. The
 * reducer must keep the PREVIOUS object when nothing moved (so React bails and
 * the composer renders once per keystroke, not twice) while still reporting a
 * genuine move — including a move to the very end, which is what gates the
 * inline-completion ghost.
 */
test('caret state bails on a repeated report and updates on a real move', () => {
  const first = nextCaretInText(null, 5, 'hello')
  expect(first).toEqual({ offset: 5, text: 'hello' })

  // Same caret, same text (change → keyUp for one keystroke): identical object.
  expect(nextCaretInText(first, 5, 'hello')).toBe(first)

  // Caret moved within the same text (ArrowLeft): new object.
  const moved = nextCaretInText(first, 4, 'hello')
  expect(moved).not.toBe(first)
  expect(moved).toEqual({ offset: 4, text: 'hello' })

  // Same offset but a DIFFERENT text (programmatic replace) must not be bailed:
  // the offset is only trusted while its text still matches the live prompt.
  const retyped = nextCaretInText(moved, 4, 'world')
  expect(retyped).not.toBe(moved)
  expect(retyped).toEqual({ offset: 4, text: 'world' })
})
