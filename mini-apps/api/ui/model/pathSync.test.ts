import { describe, expect, test } from 'bun:test'
import { syncPathParameters } from './pathSync'

describe('syncPathParameters', () => {
  test('derives unique rows in URL order', () => {
    expect(syncPathParameters('https://api.dev/users/:id/posts/:postId/by/:id')).toEqual([
      { name: 'id', value: '' },
      { name: 'postId', value: '' },
    ])
  })

  test('preserves values and disabled state while dropping stale names', () => {
    expect(
      syncPathParameters('https://api.dev/teams/:team/users/:id', [
        { name: 'id', value: '42' },
        { name: 'old', value: 'gone', disabled: true },
        { name: 'team', value: 'core', disabled: true },
      ]),
    ).toEqual([
      { name: 'team', value: 'core', disabled: true },
      { name: 'id', value: '42' },
    ])
  })

  test('returns no rows when the URL has no path placeholders', () => {
    expect(syncPathParameters('https://api.dev/users')).toEqual([])
  })
})
