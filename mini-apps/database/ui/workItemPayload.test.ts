import { describe, expect, test } from 'bun:test'
import type { WorkItemLike } from '@localixai/mini-app-sdk/ui'
import { readConsoleItem, readTableItem } from './workItemPayload'

const consoleItem = (id: string, dialect: string): WorkItemLike => ({
  kind: 'database:console',
  id,
  title: 'cache',
  payload: { connectionId: 'redis-1', dialect, readonly: true },
})

describe('readConsoleItem', () => {
  // Two consoles on one connection share a connection id; only the WorkItem id tells their
  // drafts apart. A body that keyed the console by connection gave both tabs one draft.
  test.each(['redis', 'mongodb', 'elasticsearch', 'postgres'])(
    'gives every %s console its own id, distinct from a sibling on the same connection',
    (dialect) => {
      const first = readConsoleItem(consoleItem('db-console:redis-1', dialect))
      const second = readConsoleItem(consoleItem('db-console:redis-1:2', dialect))
      expect(first.connectionId).toBe(second.connectionId)
      expect(first.consoleId).toBe('db-console:redis-1')
      expect(second.consoleId).toBe('db-console:redis-1:2')
    },
  )

  test('falls back to a writable sqlite console for a payload-less item', () => {
    expect(readConsoleItem({ kind: 'database:console', id: 'c', title: 'x' })).toEqual({
      consoleId: 'c',
      connectionId: '',
      dialect: 'sqlite',
      readonly: false,
      dbLabel: 'x',
    })
  })
})

describe('readTableItem', () => {
  test('ignores non-string optional fields rather than passing them through', () => {
    const props = readTableItem({
      kind: 'database:table',
      id: 't',
      title: 'users',
      payload: { connectionId: 'pg', schema: 7, requestedMode: null, requestNonce: 3 },
    })
    expect(props).toMatchObject({
      connectionId: 'pg',
      connectionName: 'pg',
      table: 'users',
      schema: undefined,
      requestedMode: undefined,
      requestNonce: undefined,
    })
  })
})
