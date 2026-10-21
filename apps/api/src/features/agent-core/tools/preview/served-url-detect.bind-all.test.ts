/**
 * The bind-all banners. Both addresses mean "every interface" and answer at `localhost`;
 * a detector that normalizes one and rejects the other misses whichever half the server
 * prints. For example, Python's `http.server` on macOS advertised
 * `http://[::]:4173/`, nothing latched, and the preview never opened.
 */
import { describe, expect, test } from 'bun:test'

import { classifyHost, detectServedUrl, isUnspecifiedHost } from './served-url-detect'

describe('bind-all hosts', () => {
  test('the IPv6 wildcard `[::]` normalizes to localhost, like `0.0.0.0` always did', () => {
    expect(detectServedUrl('Serving HTTP on :: port 4173 (http://[::]:4173/) ...')).toBe(
      'http://localhost:4173',
    )
    expect(detectServedUrl('Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/) ...')).toBe(
      'http://localhost:8000',
    )
  })

  test('both wildcards classify as loopback and neither is "unspecified"', () => {
    expect(classifyHost('::')).toBe('loopback')
    expect(classifyHost('[::]')).toBe('loopback')
    expect(classifyHost('0.0.0.0')).toBe('loopback')
    expect(isUnspecifiedHost('::')).toBe(false)
    expect(isUnspecifiedHost('0.0.0.0')).toBe(false)
  })

  test('a literal `*` is still not an address and is still rejected', () => {
    expect(isUnspecifiedHost('*')).toBe(true)
    expect(detectServedUrl('listening on http://*:3000')).toBeUndefined()
  })

  test('the real IPv6 loopback keeps its own form', () => {
    expect(detectServedUrl('Listening on http://[::1]:3000')).toBe('http://[::1]:3000')
  })
})
