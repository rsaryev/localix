import { describe, expect, test } from 'bun:test'
import { diffLineOf, leadingGlyphOf } from './modText'

describe('a coloured line that starts with a sign is a diff line', () => {
  test('green after + is an added line, red after − a removed one', () => {
    expect(diffLineOf({ color: 'green' }, ['+ const a = 1'])).toEqual({
      kind: 'add',
      sign: '+',
      rest: ' const a = 1',
    })
    expect(diffLineOf({ color: 'redBright' }, ['-'])).toEqual({ kind: 'del', sign: '-', rest: '' })
  })

  test('a count, a sign in another colour, or a line built of parts is not', () => {
    expect(diffLineOf({ color: 'green' }, ['+31'])).toBeNull()
    expect(diffLineOf({ color: 'red' }, ['+ x'])).toBeNull()
    expect(diffLineOf({}, ['+ x'])).toBeNull()
    expect(
      diffLineOf({ color: 'green' }, ['+ ', { type: 'Text', props: {}, children: [] }]),
    ).toBeNull()
  })
})

describe('a leading glyph is an icon, not a word', () => {
  test('a symbol and its space split off the text', () => {
    expect(leadingGlyphOf(['▶ Replay: 1 edit'])).toEqual({ glyph: '▶', rest: ' Replay: 1 edit' })
    expect(leadingGlyphOf(['☁  Cloudy'])).toEqual({ glyph: '☁', rest: '  Cloudy' })
    expect(leadingGlyphOf(['⚠ Blast Radius'])).toEqual({ glyph: '⚠', rest: ' Blast Radius' })
  })

  test('words, numbers, signs and glyphs with no space after them stay text', () => {
    expect(leadingGlyphOf(['Replay'])).toBeNull()
    expect(leadingGlyphOf(['+ x'])).toBeNull()
    expect(leadingGlyphOf(['▶Next'])).toBeNull()
    expect(leadingGlyphOf(['3 files'])).toBeNull()
  })
})
