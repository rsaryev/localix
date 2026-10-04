import { describe, expect, test } from 'bun:test'

import { collapseDoubledText } from './doubled-text'

const LINE =
  '@localix, pick a word and confirm only that it is chosen. Do not reveal it. Then we begin the first round of questions.'

describe('collapseDoubledText — a verbatim second copy is removed', () => {
  test('the recorded row: one paragraph, then the same paragraph again', () => {
    expect(collapseDoubledText(`${LINE}\n\n${LINE}`)).toBe(LINE)
  })

  test('several paragraphs repeated as a block collapse to the block', () => {
    const block = `${LINE}\n\nA second paragraph of the same reply, long enough to count as one.`
    expect(collapseDoubledText(`${block}\n\n${block}`)).toBe(block)
  })

  test('trailing whitespace around the copy does not hide it', () => {
    expect(collapseDoubledText(`${LINE}\n\n${LINE}\n`)).toBe(LINE)
  })

  test('a short answer said twice stays as written', () => {
    expect(collapseDoubledText('yes\n\nyes')).toBe('yes\n\nyes')
  })

  test('two different paragraphs stay as written', () => {
    const text = `${LINE}\n\nThis one is a different paragraph with different content, and must be left alone.`
    expect(collapseDoubledText(text)).toBe(text)
  })

  test('an odd number of paragraphs is never touched', () => {
    const text = `${LINE}\n\n${LINE}\n\nAnd one more paragraph after the repeat, which makes the count odd.`
    expect(collapseDoubledText(text)).toBe(text)
  })
})
