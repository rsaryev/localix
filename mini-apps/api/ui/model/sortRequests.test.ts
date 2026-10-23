/**
 * The ordering and grouping logic. Pure, so it tests with no DOM and no store — the same reason
 * `presentation.test.ts` can assert a whole vocabulary without a render.
 *
 * The load-bearing cases: a sort NEVER mutates its input (the caller's list comes from the store),
 * every mode is a TOTAL order with a stable tie-break, and a templated host lands in its own honest
 * bucket instead of being mis-parsed under "".
 */

import { describe, expect, test } from 'bun:test'
import type { RequestInfo } from '../../backend/contracts'
import type { HttpMethod } from '../../backend/request-spec'
import { groupKey, sortRequests, TEMPLATED_HOST_BUCKET, type GroupMode } from './sortRequests'

/** A `RequestInfo` with only the fields the sort/group reads set — the rest of the spec is inert
 *  here and defaulting it keeps each case to the one axis it tests. */
function req(
  name: string,
  opts: { method?: HttpMethod; url?: string; updatedAt?: number } = {},
): RequestInfo {
  return {
    name,
    createdAt: 0,
    updatedAt: opts.updatedAt ?? 0,
    spec: {
      url: opts.url ?? 'https://api.example.com/x',
      method: opts.method ?? 'GET',
      headers: [],
      query: [],
      auth: { type: 'none' },
    },
  }
}

const names = (rs: RequestInfo[]) => rs.map((r) => r.name)

describe('sortRequests', () => {
  test('name is the default and sorts by localeCompare', () => {
    const list = [req('Charlie'), req('alpha'), req('Bravo')]
    // localeCompare, not codepoint order: 'alpha' sorts before 'Bravo' despite the capital B.
    expect(names(sortRequests(list))).toEqual(['alpha', 'Bravo', 'Charlie'])
    expect(names(sortRequests(list, 'name'))).toEqual(['alpha', 'Bravo', 'Charlie'])
  })

  test('never mutates its input', () => {
    const list = [req('b'), req('a')]
    const before = names(list)
    sortRequests(list, 'name')
    expect(names(list)).toEqual(before)
  })

  test('method groups by verb, alphabetical within a verb', () => {
    const list = [
      req('z-get', { method: 'GET' }),
      req('post', { method: 'POST' }),
      req('a-get', { method: 'GET' }),
      req('del', { method: 'DELETE' }),
    ]
    // Verbs in alphabetical order (DELETE, GET, POST); within GET the names tie-break.
    expect(names(sortRequests(list, 'method'))).toEqual(['del', 'a-get', 'z-get', 'post'])
  })

  test('recent is updatedAt descending, name as tie-break', () => {
    const list = [
      req('old', { updatedAt: 100 }),
      req('newest', { updatedAt: 300 }),
      req('mid-b', { updatedAt: 200 }),
      req('mid-a', { updatedAt: 200 }),
    ]
    // Newest first; the two saved at the same instant fall back to alphabetical, not render order.
    expect(names(sortRequests(list, 'recent'))).toEqual(['newest', 'mid-a', 'mid-b', 'old'])
  })

  test('a tie is broken stably by name in every mode', () => {
    const same = [req('c'), req('a'), req('b')] // all identical method + updatedAt
    expect(names(sortRequests(same, 'method'))).toEqual(['a', 'b', 'c'])
    expect(names(sortRequests(same, 'recent'))).toEqual(['a', 'b', 'c'])
  })
})

describe('groupKey', () => {
  test('none is a single bucket', () => {
    expect(groupKey(req('x'), 'none')).toBe('')
    expect(groupKey(req('y', { url: '{{base_url}}/z' }), 'none')).toBe('')
  })

  test('method is the verb verbatim', () => {
    expect(groupKey(req('x', { method: 'DELETE' }), 'method')).toBe('DELETE')
  })

  test('host is the parsed host, port included', () => {
    expect(groupKey(req('x', { url: 'https://api.example.com/users' }), 'host')).toBe(
      'api.example.com',
    )
    // A non-default port is part of the endpoint identity, so it stays in the heading.
    expect(groupKey(req('x', { url: 'https://api.example.com:8443/users' }), 'host')).toBe(
      'api.example.com:8443',
    )
  })

  test('a templated url lands in the templated bucket, not under ""', () => {
    expect(groupKey(req('x', { url: '{{ base_url }}/users' }), 'host')).toBe(TEMPLATED_HOST_BUCKET)
    expect(groupKey(req('x', { url: '{{base_url}}' }), 'host')).toBe(TEMPLATED_HOST_BUCKET)
  })

  test('an unparseable or hostless url shares the templated bucket', () => {
    expect(groupKey(req('x', { url: '/relative/path' }), 'host')).toBe(TEMPLATED_HOST_BUCKET)
    expect(groupKey(req('x', { url: 'not a url' }), 'host')).toBe(TEMPLATED_HOST_BUCKET)
  })

  test('every request maps to exactly one non-null bucket', () => {
    const list = [
      req('a', { url: 'https://a.com/x', method: 'GET' }),
      req('b', { url: '{{v}}/x', method: 'POST' }),
      req('c', { url: '/rel', method: 'PUT' }),
    ]
    for (const mode of ['none', 'host', 'method'] as GroupMode[]) {
      for (const r of list) expect(typeof groupKey(r, mode)).toBe('string')
    }
  })
})
