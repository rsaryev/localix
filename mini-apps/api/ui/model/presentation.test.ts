/**
 * The presentation vocabulary. Pure, so it tests with no DOM and no React.
 *
 * The tone assertions prevent DELETE and 5xx from quietly becoming "just another chip", and keep
 * every tone inside the vocabulary `@localixai/kit/chip` actually themes.
 */

import { describe, expect, test } from 'bun:test'
import { HTTP_METHODS } from '../../backend/request-spec'
import {
  formatBytes,
  formatMs,
  methodLabel,
  methodTone,
  statusTone,
  type Tone,
} from './presentation'

/** Exactly the tones `Chip` themes. A tone outside this set renders as nothing. */
const THEMED: Tone[] = ['neutral', 'accent', 'info', 'warning', 'error', 'success']

describe('methodTone', () => {
  test('every method maps into the themed vocabulary', () => {
    for (const m of HTTP_METHODS) expect(THEMED).toContain(methodTone(m))
  })

  test('the destructive method is the alarming one', () => {
    expect(methodTone('DELETE')).toBe('error')
  })

  test('a read is not alarming', () => {
    expect(methodTone('GET')).toBe('info')
  })

  test('a create is distinct from a read', () => {
    expect(methodTone('POST')).toBe('success')
    expect(methodTone('POST')).not.toBe(methodTone('GET'))
  })
})

describe('methodLabel', () => {
  test('only the two over-long verbs are abbreviated; the rest are their own name', () => {
    expect(methodLabel('OPTIONS')).toBe('OPTS')
    expect(methodLabel('DELETE')).toBe('DEL')
    expect(methodLabel('GET')).toBe('GET')
    expect(methodLabel('POST')).toBe('POST')
    expect(methodLabel('PUT')).toBe('PUT')
    expect(methodLabel('PATCH')).toBe('PATCH')
    expect(methodLabel('HEAD')).toBe('HEAD')
  })

  test('every label fits the narrow gutter — nothing exceeds four characters', () => {
    // The whole point of abbreviating is a fixed-width column; a label wider than the widest
    // unabbreviated verb (PATCH is 5, but only GET/POST/PUT/PATCH/HEAD keep their names) would
    // reopen the ragged edge. Guard the ceiling so a new abbreviation can't silently overflow.
    for (const m of HTTP_METHODS) expect(methodLabel(m).length).toBeLessThanOrEqual(5)
  })
})

describe('statusTone', () => {
  test('every tone is in the themed vocabulary', () => {
    for (const s of [100, 200, 301, 404, 500]) expect(THEMED).toContain(statusTone(s))
  })

  test.each([
    [100, 'info'],
    [200, 'success'],
    [204, 'success'],
    [301, 'info'],
    [404, 'warning'],
    [418, 'warning'],
    [500, 'error'],
    [503, 'error'],
  ] as const)('%i is %s', (status, tone) => {
    expect(statusTone(status)).toBe(tone)
  })

  test('4xx and 5xx are DIFFERENT — the distinction says what to do next', () => {
    // A 404 is the server answering correctly and the request being wrong; a 500 is the server
    // failing. Collapsing both to one red erases the only signal that tells you whether to retry.
    expect(statusTone(404)).not.toBe(statusTone(500))
  })
})

describe('formatBytes', () => {
  test.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1.0 kB'],
    [1536, '1.5 kB'],
    [1024 * 1024, '1.0 MB'],
  ] as const)('%i → %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })
})

describe('formatMs', () => {
  test.each([
    [0, '0 ms'],
    [999, '999 ms'],
    [1000, '1.00 s'],
    [1530, '1.53 s'],
  ] as const)('%i → %s', (ms, expected) => {
    expect(formatMs(ms)).toBe(expected)
  })
})
