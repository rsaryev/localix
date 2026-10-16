import { describe, expect, it } from 'bun:test'
import { mentionPathOf, mentionLabel, atTokenLength } from './fileMention'

describe('mentionPathOf', () => {
  it('accepts path-like tokens', () => {
    expect(mentionPathOf('apps/ui/foo.ts')).toBe('apps/ui/foo.ts')
    expect(mentionPathOf('README.md')).toBe('README.md')
  })
  it('strips trailing punctuation', () => {
    expect(mentionPathOf('a.ts.')).toBe('a.ts')
    expect(mentionPathOf('src/x.ts)')).toBe('src/x.ts')
  })
  it('rejects reserved context-ref keywords', () => {
    expect(mentionPathOf('file:foo.ts')).toBeNull()
    expect(mentionPathOf('folder:src')).toBeNull()
    expect(mentionPathOf('diff')).toBeNull()
    expect(mentionPathOf('git:5')).toBeNull()
  })
  it('rejects non-path tokens', () => {
    expect(mentionPathOf('someone')).toBeNull()
  })
})

describe('mentionLabel', () => {
  it('returns the basename', () => {
    expect(mentionLabel('apps/ui/foo.ts')).toBe('foo.ts')
  })
  it('keeps the trailing slash on a folder mention', () => {
    expect(mentionLabel('apps/ui/src/')).toBe('src/')
  })
})

describe('folder mentions (trailing slash — dragged from the file tree)', () => {
  it('accepts a nested folder path and a top-level folder', () => {
    expect(mentionPathOf('src/utils/')).toBe('src/utils/')
    expect(mentionPathOf('src/')).toBe('src/')
  })
})

describe('registry-derived reserved words (terminal/call kinds)', () => {
  it('rejects new ref-kind tokens as link-only mentions', () => {
    expect(mentionPathOf('terminal:2f9c01ab')).toBeNull()
    expect(mentionPathOf('call:toolu_01AB')).toBeNull()
  })
  it('treats new ref-kind tokens as atomic @-tokens', () => {
    expect(atTokenLength('terminal:2f9c01ab')).toBe('terminal:2f9c01ab'.length)
    expect(atTokenLength('call:toolu_01AB,')).toBe('call:toolu_01AB'.length)
  })
})
