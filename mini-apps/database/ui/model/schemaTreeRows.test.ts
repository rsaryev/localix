import { describe, expect, test } from 'bun:test'
import type { DbConnectionInfo, DbSchemas, DbTableSchema } from '../dbClient'
import { flattenConnectionRows } from './connectionTreeRows'
import { schemaTreeNavigation } from './schemaTreeNavigation'
import {
  pushObjectRows,
  type IsOpen,
  type SchemaReader,
  type SchemaTreeRow,
} from './schemaTreeRows'

const connection = {
  id: 'c1',
  name: 'Main',
  dialect: 'postgres',
  connected: true,
  readonly: false,
  createdAt: 1,
} as DbConnectionInfo

const users: DbTableSchema = {
  name: 'users',
  type: 'table',
  columns: [
    { name: 'id', dataType: 'int', nullable: false, pk: true },
    { name: 'org_id', dataType: 'int', nullable: false, pk: false },
  ],
  primaryKey: ['id'],
  foreignKeys: [{ columns: ['org_id'], refTable: 'orgs', refColumns: ['id'] }],
  indexes: [{ name: 'users_pkey', columns: ['id'], unique: true, primary: true }],
}

function reader(schemas: DbSchemas | null, overrides: Partial<SchemaReader> = {}): SchemaReader {
  return {
    schemas,
    loading: false,
    error: null,
    errorDetail: null,
    reload() {},
    getTable: (name) => (name === 'users' ? users : undefined),
    getTableError: () => undefined,
    getTableErrorDetail: () => undefined,
    loadTable() {},
    reloadTable() {},
    ...overrides,
  }
}

const openAll: IsOpen = () => true
const summary = (rows: SchemaTreeRow[]) => rows.map((row) => `${row.depth}:${row.kind}`)

function connectionRows(
  r: SchemaReader | undefined,
  extra: Partial<Parameters<typeof flattenConnectionRows>[0]> = {},
) {
  return flattenConnectionRows({
    connections: [connection],
    readers: new Map(r ? [[connection.id, r]] : []),
    isOpen: openAll,
    renaming: null,
    reconnecting: {},
    reconnectError: () => undefined,
    problemLine: () => null,
    ...extra,
  })
}

describe('flattenConnectionRows', () => {
  test('one geometry: each level is one step deeper, leaves included', () => {
    const rows = connectionRows(reader({ public: [{ name: 'users', type: 'table' }] }))
    expect(summary(rows)).toEqual([
      '0:connection',
      '1:schema',
      '2:group',
      '3:table',
      '4:column',
      '4:column',
      '4:index-label',
      '4:index',
    ])
    const fk = rows.find((row) => row.kind === 'column' && row.column.name === 'org_id')
    expect(fk?.kind === 'column' && fk.refTable).toBe('orgs')
  })

  test('an open connection shows exactly one state, in the nested tree’s precedence', () => {
    const state = (rows: SchemaTreeRow[]) =>
      rows.slice(1).map((r) => (r.kind === 'status' ? r.status : r.kind))
    expect(state(connectionRows(reader(null), { reconnecting: { c1: true } }))).toEqual([
      'connecting',
    ])
    expect(state(connectionRows(reader(null), { reconnectError: () => 'refused' }))).toEqual([
      'problem',
    ])
    expect(state(connectionRows(reader(null, { error: 'denied' })))).toEqual(['problem'])
    expect(state(connectionRows(reader(null)))).toEqual(['loading'])
    expect(state(connectionRows(reader({})))).toEqual(['no-objects'])
    expect(
      state(
        flattenConnectionRows({
          ...baseInput(),
          connections: [{ ...connection, connected: false }],
        }),
      ),
    ).toEqual(['disconnected'])
  })

  test('a failed column read is a retry row, never a spinner', () => {
    const rows = connectionRows(
      reader({ public: [{ name: 'orders', type: 'table' }] }, { getTableError: () => 'denied' }),
    )
    const status = rows.at(-1)
    expect(status?.kind === 'status' && status.status).toBe('columns-error')
  })
})

function baseInput() {
  return {
    connections: [connection],
    readers: new Map<string, SchemaReader>(),
    isOpen: openAll,
    renaming: null,
    reconnecting: {},
    reconnectError: () => undefined,
    problemLine: () => null,
  }
}

describe('pushObjectRows — one connection', () => {
  test('several schemas indent their children under the header', () => {
    const rows: SchemaTreeRow[] = []
    pushObjectRows(rows, {
      connection,
      reader: reader(null),
      groups: [
        ['a', [{ item: { name: 'x', type: 'table' }, reason: 'name', matchedColumns: [] }]],
        ['b', [{ item: { name: 'y', type: 'view' }, reason: 'name', matchedColumns: [] }]],
      ],
      baseDepth: 0,
      schemaRows: 'multi',
      schemaDefaultOpen: true,
      searchActive: false,
      canEditSchema: true,
      isOpen: (_key, fallback) => fallback,
    })
    expect(summary(rows)).toEqual([
      '0:schema',
      '1:group',
      '2:table',
      '0:schema',
      '1:group',
      '2:table',
    ])
  })

  test('a column match opens its table, and an explicit close wins', () => {
    const run = (isOpen: IsOpen) => {
      const rows: SchemaTreeRow[] = []
      pushObjectRows(rows, {
        connection,
        reader: reader(null),
        groups: [
          [
            'public',
            [
              {
                item: { name: 'users', type: 'table' },
                reason: 'column',
                matchedColumns: ['org_id'],
              },
            ],
          ],
        ],
        baseDepth: 0,
        schemaRows: 'multi',
        schemaDefaultOpen: true,
        searchActive: true,
        canEditSchema: false,
        isOpen,
      })
      return rows
    }
    const opened = run((_key, fallback) => fallback)
    expect(opened.find((r) => r.kind === 'column' && r.isMatch)).toBeDefined()
    const closed = run((key, fallback) => (key.includes('"t"') ? false : fallback))
    expect(closed.some((r) => r.kind === 'column')).toBe(false)
  })
})

describe('schemaTreeNavigation', () => {
  const rows = connectionRows(reader({ public: [{ name: 'users', type: 'table' }] }))
  const key = (kind: string) => rows.find((row) => row.kind === kind)!.key

  test('Right steps into an open branch, Left returns to the parent', () => {
    expect(schemaTreeNavigation(rows, key('connection'), 'ArrowRight')).toEqual({
      kind: 'focus',
      key: key('schema'),
    })
    expect(schemaTreeNavigation(rows, key('column'), 'ArrowLeft')).toEqual({
      kind: 'focus',
      key: key('table'),
    })
    expect(schemaTreeNavigation(rows, key('table'), 'ArrowLeft')).toEqual({
      kind: 'toggle',
      key: key('table'),
    })
  })

  test('Down and End skip the non-item Indexes label', () => {
    const lastColumn = rows.findLast((row) => row.kind === 'column')!.key
    expect(schemaTreeNavigation(rows, lastColumn, 'ArrowDown')).toEqual({
      kind: 'focus',
      key: key('index'),
    })
    expect(schemaTreeNavigation(rows, key('connection'), 'End')).toEqual({
      kind: 'focus',
      key: key('index'),
    })
  })
})
