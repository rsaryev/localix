import { describe, expect, test } from 'bun:test'
import { canonicalUrlQuery, queryDraftFromUrl, urlWithQuery } from './querySync'

describe('URL and Params query synchronization', () => {
  test('typing a URL creates repeated and blank-value rows', () => {
    expect(queryDraftFromUrl('https://api.test/x?a=1&a=2&flag', [])).toEqual({
      url: 'https://api.test/x',
      query: [
        { name: 'a', value: '1' },
        { name: 'a', value: '2' },
        { name: 'flag', value: '' },
      ],
    })
  })

  test('disabled rows survive URL edits but do not appear in the URL', () => {
    const parsed = queryDraftFromUrl('https://api.test/x?page=2', [
      { name: 'debug', value: '1', disabled: true },
      { name: 'old', value: 'gone' },
    ])
    expect(parsed.query).toEqual([
      { name: 'page', value: '2' },
      { name: 'debug', value: '1', disabled: true },
    ])
    expect(urlWithQuery(parsed.url, parsed.query)).toBe('https://api.test/x?page=2')
  })

  test('a fragment remains after the query', () => {
    const parsed = queryDraftFromUrl('https://api.test/x?q=hello+world#result', [])
    expect(parsed).toEqual({
      url: 'https://api.test/x#result',
      query: [{ name: 'q', value: 'hello world' }],
    })
    expect(urlWithQuery(parsed.url, parsed.query)).toBe('https://api.test/x?q=hello%20world#result')
  })

  test('environment templates stay readable', () => {
    expect(urlWithQuery('{{base_url}}/users', [{ name: 'tenant', value: '{{tenant_id}}' }])).toBe(
      '{{base_url}}/users?tenant={{tenant_id}}',
    )
  })

  test('malformed percent escapes remain editable', () => {
    expect(queryDraftFromUrl('https://api.test/x?q=%', []).query).toEqual([
      { name: 'q', value: '%' },
    ])
  })

  test('legacy embedded query is canonicalized once', () => {
    expect(
      canonicalUrlQuery('https://api.test/x?from=url', [
        { name: 'from', value: 'grid' },
        { name: 'off', value: '1', disabled: true },
      ]),
    ).toEqual({
      url: 'https://api.test/x',
      query: [
        { name: 'from', value: 'url' },
        { name: 'off', value: '1', disabled: true },
      ],
    })
  })
})
