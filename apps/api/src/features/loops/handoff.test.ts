import { describe, expect, test } from 'bun:test'

import { handoffFromFinalText, readLoopHandoff, renderInheritedHandoff } from './handoff'

describe("handoffFromFinalText — the round's final reply is its report", () => {
  test('a reply becomes the handoff, trimmed', () => {
    expect(handoffFromFinalText('  Fixed the parser.\n')).toEqual({ summary: 'Fixed the parser.' })
  })

  test('silence hands nothing over', () => {
    expect(handoffFromFinalText('')).toBeUndefined()
    expect(handoffFromFinalText('   ')).toBeUndefined()
    expect(handoffFromFinalText(null)).toBeUndefined()
  })

  test('bounds the text so a round cannot grow the next prompt', () => {
    expect(handoffFromFinalText('x'.repeat(5_000))?.summary.length).toBe(2_000)
  })
})

describe('readLoopHandoff — a stored row is re-validated, never trusted', () => {
  test('reads a well-formed row', () => {
    expect(readLoopHandoff({ summary: 'Fixed the parser' })).toEqual({
      summary: 'Fixed the parser',
    })
  })

  test('a row from the retired structured shape still yields its summary', () => {
    expect(readLoopHandoff({ status: 'continue', summary: 'half done', evidence: ['e1'] })).toEqual(
      {
        summary: 'half done',
      },
    )
  })

  test('no summary, no handoff', () => {
    expect(readLoopHandoff({ status: 'done' })).toBeUndefined()
    expect(readLoopHandoff('not a handoff')).toBeUndefined()
    expect(readLoopHandoff(42)).toBeUndefined()
    expect(readLoopHandoff(null)).toBeUndefined()
  })
})

describe('renderInheritedHandoff', () => {
  test('names the round and carries the reply', () => {
    const rendered = renderInheritedHandoff({ summary: 'Parser fixed' }, 3)
    expect(rendered).toBe('Previous round (#3) reported:\nParser fixed')
  })
})
