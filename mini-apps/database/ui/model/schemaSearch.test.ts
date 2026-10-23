import { describe, expect, it } from 'bun:test'
import type { DbSchemas, DbTableSchema } from '../dbClient'
import { matchSchemaItem, searchSchemas } from './schemaSearch'
import { schemaTableKey } from './schemaKey'

/** Minimal loaded-table fixture — only `columns[].name` matters to the matcher. */
function table(name: string, columns: string[]): DbTableSchema {
  return {
    name,
    type: 'table',
    columns: columns.map((c) => ({ name: c, dataType: 'text', nullable: true, pk: false })),
    primaryKey: [],
    foreignKeys: [],
    indexes: [],
  }
}

describe('matchSchemaItem', () => {
  const users = { name: 'users', type: 'table' } as const

  it('matches by object name (reason=name, no matched columns)', () => {
    const m = matchSchemaItem(users, undefined, 'use')
    expect(m).not.toBeNull()
    expect(m?.reason).toBe('name')
    expect(m?.matchedColumns).toEqual([])
  })

  it('matches by loaded column when the name does not (reason=column)', () => {
    const cols = [{ name: 'id' }, { name: 'email' }, { name: 'created_at' }]
    const m = matchSchemaItem({ name: 'orders', type: 'table' }, cols, 'email')
    expect(m?.reason).toBe('column')
    expect(m?.matchedColumns).toEqual(['email'])
  })

  it('returns all matching columns and keeps reason=name when the name also matches', () => {
    const cols = [{ name: 'email' }, { name: 'email_verified' }, { name: 'name' }]
    const m = matchSchemaItem({ name: 'email_log', type: 'table' }, cols, 'email')
    // Name matched, so reason is name — but matched columns are still returned to highlight.
    expect(m?.reason).toBe('name')
    expect(m?.matchedColumns).toEqual(['email', 'email_verified'])
  })

  it('returns null when neither the name nor any loaded column matches', () => {
    const cols = [{ name: 'id' }, { name: 'total' }]
    expect(matchSchemaItem({ name: 'orders', type: 'table' }, cols, 'email')).toBeNull()
  })

  it('is case-insensitive on both name and columns', () => {
    expect(matchSchemaItem({ name: 'Users', type: 'table' }, undefined, 'USE')?.reason).toBe('name')
    const cols = [{ name: 'EmailAddress' }]
    expect(
      matchSchemaItem({ name: 'orders', type: 'table' }, cols, 'email')?.matchedColumns,
    ).toEqual(['EmailAddress'])
  })

  it('cannot match columns that have not loaded yet (columns undefined)', () => {
    // Name does not contain the query and columns are unknown → excluded.
    expect(matchSchemaItem({ name: 'orders', type: 'table' }, undefined, 'email')).toBeNull()
  })

  it('returns null for a blank query', () => {
    expect(matchSchemaItem(users, [{ name: 'x' }], '   ')).toBeNull()
  })
})

describe('searchSchemas', () => {
  const SCHEMAS: DbSchemas = {
    public: [
      { name: 'users', type: 'table' },
      { name: 'orders', type: 'table' },
      { name: 'user_view', type: 'view' },
    ],
    audit: [{ name: 'events', type: 'table' }],
  }

  it('returns null for a blank query so the caller shows the full tree', () => {
    expect(searchSchemas(SCHEMAS, {}, '')).toBeNull()
    expect(searchSchemas(SCHEMAS, {}, '   ')).toBeNull()
  })

  it('matches by name with no columns loaded', () => {
    const res = searchSchemas(SCHEMAS, {}, 'user')
    expect(res?.total).toBe(2) // users + user_view
    const names = res?.groups.flatMap(([, ms]) => ms.map((m) => m.item.name))
    expect(names).toEqual(['users', 'user_view'])
    expect(res?.groups.every(([, ms]) => ms.every((m) => m.reason === 'name'))).toBe(true)
  })

  it('surfaces a table by a loaded column and reports which columns matched', () => {
    const tables = {
      orders: table('orders', ['id', 'customer_email', 'total']),
      events: table('events', ['id', 'kind']),
    }
    const res = searchSchemas(SCHEMAS, tables, 'email')
    // orders' name does not contain "email" — it is included only via its column.
    expect(res?.total).toBe(1)
    const [schemaName, matches] = res!.groups[0]
    expect(schemaName).toBe('public')
    expect(matches[0].item.name).toBe('orders')
    expect(matches[0].reason).toBe('column')
    expect(matches[0].matchedColumns).toEqual(['customer_email'])
  })

  it('drops schema groups that have no match, preserving order for the rest', () => {
    const tables = { events: table('events', ['id', 'user_id']) }
    // "user" hits public.users + public.user_view by name AND audit.events by its user_id column.
    const res = searchSchemas(SCHEMAS, tables, 'user')
    expect(res?.groups.map(([s]) => s)).toEqual(['public', 'audit'])
    const audit = res?.groups.find(([s]) => s === 'audit')
    expect(audit?.[1][0].item.name).toBe('events')
    expect(audit?.[1][0].reason).toBe('column')
    expect(audit?.[1][0].matchedColumns).toEqual(['user_id'])
  })

  it('returns no groups when nothing matches anywhere', () => {
    const res = searchSchemas(SCHEMAS, { orders: table('orders', ['id']) }, 'zzz')
    expect(res).toEqual({ groups: [], total: 0 })
  })

  it('is case-insensitive across the tree', () => {
    const tables = { orders: table('orders', ['CustomerEmail']) }
    const res = searchSchemas(SCHEMAS, tables, 'EMAIL')
    expect(res?.total).toBe(1)
    expect(res?.groups[0][1][0].matchedColumns).toEqual(['CustomerEmail'])
  })

  it('searches the correct structure when schemas contain equal table names', () => {
    const schemas: DbSchemas = {
      public: [{ name: 'events', type: 'table' }],
      audit: [{ name: 'events', type: 'table' }],
    }
    const tables = {
      [schemaTableKey('events', 'public')]: table('events', ['payload']),
      [schemaTableKey('events', 'audit')]: table('events', ['actor_email']),
    }
    const res = searchSchemas(schemas, tables, 'email')
    expect(res?.groups.map(([schema]) => schema)).toEqual(['audit'])
  })
})
