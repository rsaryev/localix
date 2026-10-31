import { describe, expect, test } from 'bun:test'

import { appendSpokenText } from './spoken-text'

describe('appendSpokenText', () => {
  test('a new text part starts a paragraph; fragments of one part and existing whitespace join as is', () => {
    expect(
      appendSpokenText(
        '\u0441\u043e\u043e\u0431\u0449\u0438 \u0444\u0430\u0439\u043b\u044b.',
        '\u041f\u043e\u0440\u0443\u0447\u0438\u043b frontend_builder',
        true,
      ),
    ).toBe(
      '\u0441\u043e\u043e\u0431\u0449\u0438 \u0444\u0430\u0439\u043b\u044b.\n\n\u041f\u043e\u0440\u0443\u0447\u0438\u043b frontend_builder',
    )
    expect(appendSpokenText('A.', 'B', false)).toBe('A.B')
    expect(appendSpokenText('A.\n', 'B', true)).toBe('A.\nB')
    expect(appendSpokenText('Building the team: ', 'design drafts it.', true)).toBe(
      'Building the team: design drafts it.',
    )
    expect(appendSpokenText('', 'B', true)).toBe('B')
  })
})
