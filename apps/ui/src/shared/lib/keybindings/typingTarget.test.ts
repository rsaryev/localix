import { describe, expect, test } from 'bun:test'

import { isTypingTarget } from './typingTarget'

const element = (tagName: string, contentEditable = false) =>
  ({ tagName, isContentEditable: contentEditable }) as unknown as Element

describe('isTypingTarget', () => {
  test('null is not a typing target', () => {
    expect(isTypingTarget(null)).toBe(false)
  })

  test.each(['INPUT', 'TEXTAREA'])('%s takes text', (tag) => {
    expect(isTypingTarget(element(tag))).toBe(true)
  })

  test('a contentEditable element takes text — the case the weaker copy missed', () => {
    expect(isTypingTarget(element('DIV', true))).toBe(true)
  })

  test('an ordinary element does not', () => {
    expect(isTypingTarget(element('DIV'))).toBe(false)
    expect(isTypingTarget(element('BUTTON'))).toBe(false)
  })
})
