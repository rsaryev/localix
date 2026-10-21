import { describe, it, expect } from 'bun:test'
import { detectToken, looksLikeMentionPartial } from './atRefToken'

describe('looksLikeMentionPartial', () => {
  it('is true for slashed, dotted, or 2+ char partials', () => {
    expect(looksLikeMentionPartial('a/b')).toBe(true)
    expect(looksLikeMentionPartial('a.txt')).toBe(true)
    expect(looksLikeMentionPartial('ab')).toBe(true)
  })

  it('is false for a single bare char or empty', () => {
    expect(looksLikeMentionPartial('a')).toBe(false)
    expect(looksLikeMentionPartial('')).toBe(false)
  })
})

describe('detectToken — no token', () => {
  it('returns null without a trailing @-token', () => {
    expect(detectToken('hello world')).toBeNull()
    expect(detectToken('')).toBeNull()
  })

  it('ignores an @ not preceded by start or whitespace (e.g. an email)', () => {
    expect(detectToken('email@domain')).toBeNull()
  })

  it('returns null once a space completes the token', () => {
    expect(detectToken('@file done')).toBeNull()
  })
})

describe('detectToken — type mode', () => {
  it('opens the type menu on a bare @ with an empty partial', () => {
    expect(detectToken('@')).toEqual({ start: 0, end: 1, mode: 'type', partial: '' })
  })

  it('keeps the type menu while the partial prefixes a reserved kind', () => {
    expect(detectToken('@f')).toMatchObject({ mode: 'type', partial: 'f' })
    expect(detectToken('@fi')).toMatchObject({ mode: 'type', partial: 'fi' })
    expect(detectToken('@file')).toMatchObject({ mode: 'type', partial: 'file' })
  })

  it('reports the @ position when typed mid-prompt', () => {
    expect(detectToken('hello @')).toEqual({ start: 6, end: 7, mode: 'type', partial: '' })
  })
})

describe('detectToken — session mode', () => {
  it('keeps the type menu while the partial prefixes "session:"', () => {
    expect(detectToken('@se')).toMatchObject({ mode: 'type', partial: 'se' })
    expect(detectToken('@session')).toMatchObject({ mode: 'type', partial: 'session' })
  })

  it('switches to session search once the colon is typed', () => {
    expect(detectToken('@session:')).toEqual({ start: 0, end: 9, mode: 'session', partial: '' })
    expect(detectToken('@session:log')).toMatchObject({ mode: 'session', partial: 'log' })
    expect(detectToken('link @session:LOCALIX-4')).toMatchObject({
      start: 5,
      mode: 'session',
      partial: 'LOCALIX-4',
    })
  })
})

describe('detectToken — ref-path mode', () => {
  it('detects @file: with an empty partial', () => {
    expect(detectToken('@file:')).toEqual({
      start: 0,
      end: 6,
      mode: 'ref-path',
      kind: 'file',
      partial: '',
    })
  })

  it('detects @folder: with a directory partial', () => {
    expect(detectToken('@folder:src/')).toEqual({
      start: 0,
      end: 12,
      mode: 'ref-path',
      kind: 'folder',
      partial: 'src/',
    })
  })

  it('keeps the slashed sub-path in the partial', () => {
    expect(detectToken('@file:a/b/c')).toMatchObject({
      mode: 'ref-path',
      kind: 'file',
      partial: 'a/b/c',
    })
  })

  it('reports the @ position when typed mid-prompt', () => {
    expect(detectToken('see @file:foo')).toMatchObject({
      start: 4,
      mode: 'ref-path',
      kind: 'file',
      partial: 'foo',
    })
  })
})

describe('detectToken — mention mode', () => {
  it('treats a dotted or longer partial as a file mention search', () => {
    expect(detectToken('@README.md')).toMatchObject({ mode: 'mention', partial: 'README.md' })
    expect(detectToken('@components')).toMatchObject({ mode: 'mention', partial: 'components' })
  })

  it('treats a leading-slash partial as a regex mention search', () => {
    expect(detectToken('@/foo.*')).toEqual({ start: 0, end: 7, mode: 'mention', partial: '/foo.*' })
  })

  it('detects a mention typed mid-prompt with the right @ offset', () => {
    expect(detectToken('look at @src')).toMatchObject({ start: 8, mode: 'mention', partial: 'src' })
  })
})

describe('terminal / call pick modes', () => {
  it('detects @terminal: and @call: tokens at the end of the prompt', () => {
    expect(detectToken('@terminal:')).toMatchObject({ mode: 'terminal', partial: '' })
    expect(detectToken('see @terminal:2f9c')).toMatchObject({ mode: 'terminal', partial: '2f9c' })
    expect(detectToken('why did @call:toolu_')).toMatchObject({ mode: 'call', partial: 'toolu_' })
  })
  it('keeps the type menu open for partial new keywords', () => {
    expect(detectToken('@ter')).toMatchObject({ mode: 'type', partial: 'ter' })
    expect(detectToken('@ca')).toMatchObject({ mode: 'type', partial: 'ca' })
  })
})

describe('detectToken — caret awareness', () => {
  it('detects the token at the caret, not the string tail', () => {
    // Caret inside the token → the truncated partial is what's being typed.
    expect(detectToken('@file:src hello', 9)).toMatchObject({
      mode: 'ref-path',
      partial: 'src',
      end: 9,
    })
    expect(detectToken('@file:src hello', 8)).toMatchObject({
      mode: 'ref-path',
      partial: 'sr',
      end: 8,
    })
  })

  it('returns null when the caret is parked outside any token', () => {
    // The draft ENDS with a token, but the caret sits mid-text: no menu, no
    // Enter/ArrowRight interception (the hijacked-Enter bug).
    expect(detectToken('hello world @file:src', 5)).toBeNull()
    expect(detectToken('hello world @file:src', 11)).toBeNull()
  })

  it('defaults to end-of-text when no caret is given (legacy behavior)', () => {
    expect(detectToken('hello @file:src')).toMatchObject({
      mode: 'ref-path',
      partial: 'src',
      end: 15,
    })
  })

  it('clamps an out-of-range caret to the text bounds', () => {
    expect(detectToken('@file:a', 99)).toMatchObject({ mode: 'ref-path', partial: 'a', end: 7 })
    expect(detectToken('@file:a', -1)).toBeNull()
  })
})
