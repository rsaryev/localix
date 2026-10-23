import { describe, expect, test } from 'bun:test'
import { dbResourceUri } from './dbResourceUri'

describe('dbResourceUri', () => {
  test('builds the positional grammar for plain names', () => {
    expect(dbResourceUri('c1', 'public', 'orders')).toBe('localix://resource/db/c1/_/public/orders')
    expect(dbResourceUri('c1', 'public', 'orders', 'id')).toBe(
      'localix://resource/db/c1/_/public/orders/id',
    )
  })

  test('percent-encodes names with spaces/punctuation so the token grammar and segment split survive', () => {
    // `@resource:` tokens are whitespace-delimited; segments split on `/`.
    expect(dbResourceUri('c1', 'public', 'my table')).toBe(
      'localix://resource/db/c1/_/public/my%20table',
    )
    expect(dbResourceUri('c1', 'public', 'orders(archive)')).toBe(
      'localix://resource/db/c1/_/public/orders(archive)',
    )
    expect(dbResourceUri('c1', 'a/b', 't')).toBe('localix://resource/db/c1/_/a%2Fb/t')
    expect(dbResourceUri('team db', 'public', 't')).toBe(
      'localix://resource/db/team%20db/_/public/t',
    )
  })
})
