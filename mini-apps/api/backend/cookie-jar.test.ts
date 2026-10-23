/**
 * The redirect chain's cookies. The group that matters is the last one: the jar must not be able
 * to hand a session to a second origin, because that would undo `stripAuthAcrossOrigin` from the
 * inside — a guard defeated by a helper is worse than no helper.
 */

import { describe, expect, test } from 'bun:test'
import { collectCookies, cookieHeaderValue, mergeCookieHeader, parseSetCookie } from './cookie-jar'

describe('parseSetCookie', () => {
  test.each([
    ['session=abc123', { name: 'session', value: 'abc123' }],
    ['session=abc123; Path=/; HttpOnly', { name: 'session', value: 'abc123' }],
    ['session=abc123; Secure; SameSite=Lax', { name: 'session', value: 'abc123' }],
    ['  session = abc123 ; Path=/', { name: 'session', value: 'abc123' }],
    // A value may hold `=` — only the FIRST one separates.
    ['t=a=b=c', { name: 't', value: 'a=b=c' }],
    // An empty value is a value: it is how some servers blank a cookie.
    ['session=', { name: 'session', value: '' }],
  ])('%p → %j', (raw, expected) => {
    expect(parseSetCookie(raw)).toEqual(expected)
  })

  test.each([
    ['=orphan', 'no name'],
    ['flag', 'no `=` at all'],
    ['', 'empty'],
    ['   ', 'whitespace'],
  ])('%p is not a cookie (%s)', (raw) => {
    expect(parseSetCookie(raw)).toBeNull()
  })

  describe('Max-Age=0 is a deletion — a logout inside a chain', () => {
    test.each(['session=x; Max-Age=0', 'session=x; max-age=0', 'session=x; Path=/; Max-Age=-1'])(
      '%p',
      (raw) => {
        expect(parseSetCookie(raw)).toEqual({ name: 'session', deleted: true })
      },
    )

    test('a positive Max-Age is NOT a deletion', () => {
      expect(parseSetCookie('session=x; Max-Age=3600')).toEqual({ name: 'session', value: 'x' })
    })
  })
})

describe('collectCookies', () => {
  test('it folds several Set-Cookie headers in', () => {
    expect(collectCookies([], ['a=1; Path=/', 'b=2; HttpOnly'])).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
    ])
  })

  test('a later value REPLACES an earlier one — session rotation relies on this', () => {
    expect(collectCookies([{ name: 'session', value: 'old' }], ['session=new'])).toEqual([
      { name: 'session', value: 'new' },
    ])
  })

  test('Max-Age=0 removes it from the jar', () => {
    expect(collectCookies([{ name: 'session', value: 'x' }], ['session=; Max-Age=0'])).toEqual([])
  })

  test('an unparseable Set-Cookie is skipped, not fatal', () => {
    expect(collectCookies([], ['garbage', 'a=1'])).toEqual([{ name: 'a', value: '1' }])
  })

  test('the existing jar survives a response that sets nothing', () => {
    const jar = [{ name: 'a', value: '1' }]
    expect(collectCookies(jar, [])).toEqual(jar)
  })
})

describe('cookieHeaderValue', () => {
  test.each([
    [[], ''],
    [[{ name: 'a', value: '1' }], 'a=1'],
    [
      [
        { name: 'a', value: '1' },
        { name: 'b', value: '2' },
      ],
      'a=1; b=2',
    ],
  ])('%j → %p', (jar, expected) => {
    expect(cookieHeaderValue(jar)).toBe(expected)
  })
})

describe("mergeCookieHeader — the user's own Cookie wins", () => {
  test('an empty jar changes nothing', () => {
    expect(mergeCookieHeader('mine=1', [])).toBe('mine=1')
    expect(mergeCookieHeader(undefined, [])).toBe('')
  })

  test('the jar is added when there is no existing header', () => {
    expect(mergeCookieHeader(undefined, [{ name: 'session', value: 'x' }])).toBe('session=x')
  })

  test('the jar is appended to an existing header', () => {
    expect(mergeCookieHeader('mine=1', [{ name: 'session', value: 'x' }])).toBe('mine=1; session=x')
  })

  test('a name the USER set is not overwritten by the server', () => {
    // They wrote it — an `apikey` with addTo:'cookie', or a hand-set Cookie header. The server
    // merely offered. Being silently replaced mid-redirect is not a request anyone can reason about.
    expect(mergeCookieHeader('session=mine', [{ name: 'session', value: 'theirs' }])).toBe(
      'session=mine',
    )
  })

  test('…while OTHER jar cookies still get through', () => {
    expect(
      mergeCookieHeader('session=mine', [
        { name: 'session', value: 'theirs' },
        { name: 'csrf', value: 'tok' },
      ]),
    ).toBe('session=mine; csrf=tok')
  })
})
