import { describe, expect, it } from 'bun:test'

import { parseInline, spansToText } from './inline'

/**
 * Behavior lock for the inline Markdown tokenizer that feeds the docx + pdf
 * generators. Pins the pragmatic subset (bold/italic/code, link flattening) AND
 * its deliberate CommonMark deviations, so a regression in any generator's input
 * is caught here rather than in a produced document.
 */
describe('parseInline — styled spans', () => {
  it('returns a single plain span for empty input', () => {
    expect(parseInline('')).toEqual([{ text: '' }])
  })

  it('leaves plain text unstyled', () => {
    expect(parseInline('hello world')).toEqual([{ text: 'hello world' }])
  })

  it('parses **bold** and __bold__', () => {
    expect(parseInline('**bold**')).toEqual([{ text: 'bold', bold: true }])
    expect(parseInline('__bold__')).toEqual([{ text: 'bold', bold: true }])
  })

  it('parses *italic* and _italic_', () => {
    expect(parseInline('*italic*')).toEqual([{ text: 'italic', italic: true }])
    expect(parseInline('_italic_')).toEqual([{ text: 'italic', italic: true }])
  })

  it('parses `code` literally with no nested styling', () => {
    expect(parseInline('`a*b*c`')).toEqual([{ text: 'a*b*c', code: true }])
  })

  it('merges adjacent runs and styles only the marked segment', () => {
    expect(parseInline('a **b** c')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' c' },
    ])
  })

  it('nests bold and italic into a combined run', () => {
    expect(parseInline('**_bi_**')).toEqual([{ text: 'bi', bold: true, italic: true }])
  })

  it('flattens [text](url) to "text (url)" and ![alt](url) to alt', () => {
    expect(parseInline('see [docs](http://x.io)')).toEqual([{ text: 'see docs (http://x.io)' }])
    expect(parseInline('![logo](http://x.io/a.png)')).toEqual([{ text: 'logo' }])
    expect(parseInline('[x](x)')).toEqual([{ text: 'x' }]) // url === label collapses to label
  })

  // --- documented pragmatic-subset boundaries (NOT bugs — pinned on purpose) ---
  it('treats an unclosed marker as a toggle to end-of-line (marker consumed)', () => {
    expect(parseInline('**bold')).toEqual([{ text: 'bold', bold: true }])
  })

  it('emits an unmatched backtick verbatim', () => {
    expect(parseInline('a `b')).toEqual([{ text: 'a `b' }])
  })

  it('KNOWN deviation: an intra-word underscore toggles italic (not CommonMark)', () => {
    expect(parseInline('user_id')).toEqual([{ text: 'user' }, { text: 'id', italic: true }])
  })
})

describe('spansToText', () => {
  it('concatenates span text, dropping styling', () => {
    expect(spansToText(parseInline('a **b** `c`'))).toBe('a b c')
  })
})

describe('literal authored prose in office exports', () => {
  it('unescapes Markdown punctuation without styling escaped markers', () => {
    expect(parseInline('C\\+\\+ and user\\_id and \\*literal\\*')).toEqual([
      { text: 'C++ and user_id and *literal*' },
    ])
    expect(spansToText(parseInline('\\[label\\]\\(url\\)'))).toBe('[label](url)')
  })
  it('reads angle-delimited links and preserves percent escapes and parentheses', () => {
    expect(spansToText(parseInline('[Portfolio](<https://example.com/a%20b(foo)_v2>)'))).toBe(
      'Portfolio (https://example.com/a%20b(foo)_v2)',
    )
  })
})

it('preserves an unmatched parenthesis inside an angle-delimited URL', () => {
  expect(spansToText(parseInline('[Docs](<https://example.com/a)foo>)'))).toBe(
    'Docs (https://example.com/a)foo)',
  )
})
