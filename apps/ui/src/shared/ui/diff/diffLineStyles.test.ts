import { describe, expect, it } from 'bun:test'
import {
  DIFF_ROW_CLASS,
  DIFF_CTX_ROW_CLASS,
  DIFF_SIGN_CLASS,
  diffRowWash,
  diffSignGlyph,
  diffSignClass,
} from './diffLineStyles'

// These helpers replaced per-surface mapping records/ternaries in DiffView +
// DiffStagingView. The assertions lock BYTE-IDENTICAL output to what both surfaces
// rendered before, so the extraction is provably behavior-preserving.
describe('diffRowWash', () => {
  it('maps add/del to the status wash, everything else to the transparent inset', () => {
    expect(diffRowWash('add')).toBe(DIFF_ROW_CLASS.add)
    expect(diffRowWash('del')).toBe(DIFF_ROW_CLASS.del)
    expect(diffRowWash('ctx')).toBe(DIFF_CTX_ROW_CLASS)
    expect(diffRowWash('meta')).toBe(DIFF_CTX_ROW_CLASS)
  })
})

describe('diffSignGlyph', () => {
  it('is +/- for changes, a space otherwise', () => {
    expect(diffSignGlyph('add')).toBe('+')
    expect(diffSignGlyph('del')).toBe('-')
    expect(diffSignGlyph('ctx')).toBe(' ')
    expect(diffSignGlyph('meta')).toBe(' ')
  })
})

describe('diffSignClass', () => {
  it('colors +/- with the status tokens, else faint', () => {
    expect(diffSignClass('add')).toBe(DIFF_SIGN_CLASS.add)
    expect(diffSignClass('del')).toBe(DIFF_SIGN_CLASS.del)
    expect(diffSignClass('ctx')).toBe('text-text-faint')
    expect(diffSignClass('meta')).toBe('text-text-faint')
  })
})
