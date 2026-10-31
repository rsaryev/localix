import { describe, expect, test } from 'bun:test'
import type { ToolBackedItem } from '../agents/items'
import { itemResultModelText } from './result-text'

describe('itemResultModelText', () => {
  const item = (over: Partial<ToolBackedItem>): ToolBackedItem => over as unknown as ToolBackedItem

  test('prefers error.userMessage over resultText/errorText', () => {
    expect(
      itemResultModelText(
        item({
          error: { userMessage: 'friendly' },
          resultText: 'r',
          errorText: 'e',
        } as Partial<ToolBackedItem>),
      ),
    ).toBe('friendly')
  })

  test('falls back to resultText, then errorText', () => {
    expect(itemResultModelText(item({ resultText: 'r', errorText: 'e' }))).toBe('r')
    expect(itemResultModelText(item({ errorText: 'e' }))).toBe('e')
  })

  test('empty string when nothing is model-facing', () => {
    expect(itemResultModelText(item({}))).toBe('')
  })
})
