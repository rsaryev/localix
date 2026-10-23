import { describe, expect, test } from 'bun:test'
import { continueList, toggleMark } from './rich-edit'
import { parseInline, parseRichText, plainText, toggleTask } from './rich-text'

const flat = (text: string) =>
  parseInline(text).map((span) => [span.text, [...span.marks].sort().join('+')])

describe('inline marks', () => {
  test('reads each mark and nests them', () => {
    expect(flat('a **b** *c* ++d++ ~~e~~ ==f== `g`')).toEqual([
      ['a ', ''],
      ['b', 'bold'],
      [' ', ''],
      ['c', 'italic'],
      [' ', ''],
      ['d', 'underline'],
      [' ', ''],
      ['e', 'strike'],
      [' ', ''],
      ['f', 'highlight'],
      [' ', ''],
      ['g', 'code'],
    ])
    expect(flat('**bold and *both***')).toEqual([
      ['bold and ', 'bold'],
      ['both', 'bold+italic'],
    ])
  })

  test('code is literal and an unclosed or spaced marker stays text', () => {
    expect(flat('`**x**`')).toEqual([['**x**', 'code']])
    expect(flat('2 * 3 * 4')).toEqual([['2 * 3 * 4', '']])
    expect(flat('**open')).toEqual([['**open', '']])
  })

  test('underscores inside a word are not italics, and a backslash escapes', () => {
    expect(flat('snake_case_name')).toEqual([['snake_case_name', '']])
    expect(flat('_soft_ \\*literal\\*')).toEqual([
      ['soft', 'italic'],
      [' *literal*', ''],
    ])
  })
})

describe('blocks', () => {
  test('reads headings, lists, tasks and quotes per line', () => {
    const blocks = parseRichText('# Plan\n- one\n  - nested\n3. third\n- [x] done\n> said\n\nend')
    expect(blocks.map((block) => block.kind)).toEqual([
      'heading',
      'bullet',
      'bullet',
      'number',
      'task',
      'quote',
      'blank',
      'paragraph',
    ])
    expect(blocks[2]).toMatchObject({ depth: 1 })
    expect(blocks[3]).toMatchObject({ number: '3.' })
    expect(blocks[4]).toMatchObject({ checked: true, line: 4 })
  })

  test('a task box toggles in place and nothing else changes', () => {
    const text = 'Ship\n- [ ] tests\n  * [X] docs'
    expect(toggleTask(text, 1)).toBe('Ship\n- [x] tests\n  * [X] docs')
    expect(toggleTask(text, 2)).toBe('Ship\n- [ ] tests\n  * [ ] docs')
    expect(toggleTask(text, 0)).toBe(text)
  })

  test('plain text drops the markers', () => {
    expect(plainText('**Ship** it\n- [ ] `tests`')).toBe('Ship it\ntests')
  })
})

describe('format keys', () => {
  test('wraps a selection, and a second press takes the wrap off', () => {
    const on = toggleMark('ship it now', 5, 7, '**')
    expect(on).toEqual({ value: 'ship **it** now', start: 5, end: 11 })
    expect(toggleMark(on.value, on.start, on.end, '**')).toEqual({
      value: 'ship it now',
      start: 5,
      end: 7,
    })
    const inside = toggleMark('ship **it** now', 7, 9, '**')
    expect(inside).toEqual({ value: 'ship it now', start: 5, end: 7 })
  })

  test('an empty selection opens a pair, and the spaces stay outside it', () => {
    expect(toggleMark('a  b', 2, 2, '*')).toEqual({ value: 'a ** b', start: 3, end: 3 })
    expect(toggleMark('x  word  y', 1, 9, '++').value).toBe('x  ++word++  y')
    expect(toggleMark('one\ntwo', 0, 7, '~~').value).toBe('~~one~~\n~~two~~')
  })

  test('Enter continues a list, numbering on, and an empty item ends it', () => {
    expect(continueList('- one', 5)).toEqual({ value: '- one\n- ', start: 8, end: 8 })
    expect(continueList('  9. nine', 9)?.value).toBe('  9. nine\n  10. ')
    expect(continueList('- [x] done', 10)?.value).toBe('- [x] done\n- [ ] ')
    expect(continueList('a\n- ', 4)).toEqual({ value: 'a\n', start: 2, end: 2 })
    expect(continueList('plain', 5)).toBeNull()
    expect(continueList('- one', 3)).toBeNull()
  })
})
