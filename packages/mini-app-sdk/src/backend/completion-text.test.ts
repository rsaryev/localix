import { describe, expect, it } from 'bun:test'
import { cleanCompletionSuffix, completionDraftTail } from './completion-text'

describe('completion insertion boundaries', () => {
  it('preserves word continuation, spaces, newlines and exact prefix stripping', () => {
    expect(cleanCompletionSuffix('pletion', 'com')).toBe('pletion')
    expect(cleanCompletionSuffix(' tests', 'run')).toBe(' tests')
    expect(cleanCompletionSuffix('run tests', 'run')).toBe(' tests')
    expect(cleanCompletionSuffix('Run tests', 'run')).toBe('Run tests')
    expect(cleanCompletionSuffix('\nsecond line', 'first')).toBe('\nsecond line')
    expect(cleanCompletionSuffix('none', 'run')).toBe('')
  })

  it('strips an echo of the draft end in every shape the model produces', () => {
    // The unfinished word, the last words, and the visible tail of a long draft.
    expect(cleanCompletionSuffix('test suite', 'fix the te')).toBe('st suite')
    expect(cleanCompletionSuffix('the tests', 'please fix the te')).toBe('sts')
    expect(cleanCompletionSuffix('fix the tests', 'please fix the')).toBe(' tests')
    const long = `${'context '.repeat(80)}now run the`
    expect(cleanCompletionSuffix('run the suite', long)).toBe(' suite')
    // A word boundary may be punctuation, not only whitespace.
    expect(cleanCompletionSuffix('bar()', 'call foo.ba')).toBe('r()')
  })

  it('leaves a genuine continuation that merely shares letters untouched', () => {
    expect(cleanCompletionSuffix('e more', 'see')).toBe('e more')
    expect(cleanCompletionSuffix('pletion', 'com')).toBe('pletion')
    expect(cleanCompletionSuffix('Run tests', 'please run')).toBe('Run tests')
  })

  it('never doubles the joining space and drops leaked reasoning', () => {
    expect(cleanCompletionSuffix(' tests', 'fix the ')).toBe('tests')
    expect(cleanCompletionSuffix('\nnext line', 'end ')).toBe('\nnext line')
    expect(cleanCompletionSuffix('<think>user wants tests</think> tests', 'run')).toBe(' tests')
    expect(cleanCompletionSuffix('reasoning…</think>pletion', 'com')).toBe('pletion')
  })

  it('keeps the caret tail within a UTF-8 budget without splitting Unicode', () => {
    expect(completionDraftTail('earlier context 😀\u044f ', 7)).toBe('😀\u044f ')
    expect(completionDraftTail('😀', 3)).toBe('')
    expect(completionDraftTail('abc ', 2)).toBe('c ')
    expect(cleanCompletionSuffix('😀😀', '', 1)).toBe('😀')
  })
})
