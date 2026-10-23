import { describe, expect, test } from 'bun:test'
import { ResultCountStatus } from './result-count-status'

describe('ResultCountStatus', () => {
  test('owns one stable polite atomic live-region contract', () => {
    const element = ResultCountStatus({
      count: 2,
      singular: 'suggestion',
      plural: 'suggestions',
    })

    expect(element.props['data-slot']).toBe('result-count-status')
    expect(element.props.role).toBe('status')
    expect(element.props['aria-live']).toBe('polite')
    expect(element.props['aria-atomic']).toBe('true')
    expect(element.props.children).toBe('2 suggestions')
  })

  test('supports domain localization without weakening its semantics', () => {
    const element = ResultCountStatus({
      count: 1,
      formatCount: (count: number) => `Matches found: ${count}`,
    })

    expect(element.props.children).toBe('Matches found: 1')
    expect(element.props.role).toBe('status')
  })
})
