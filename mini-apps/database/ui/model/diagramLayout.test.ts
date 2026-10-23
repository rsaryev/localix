import { describe, expect, it } from 'bun:test'
import type { DbTableSchema } from '../dbClient'
import {
  decodeVisibleKey,
  layoutNodes,
  nodeIdentity,
  relationEdges,
  visibleNodeKey,
  type DiagramTable,
} from './diagramLayout'

const table = (name: string, columns: string[], schema?: string): DiagramTable => ({
  name,
  schema,
  detail: {
    name,
    schema,
    type: 'table',
    columns: columns.map((column) => ({
      name: column,
      dataType: 'text',
      nullable: true,
      pk: false,
    })),
    primaryKey: [],
    foreignKeys: [],
    indexes: [],
  } satisfies DbTableSchema,
})

const TABLES: DiagramTable[] = [
  table('users', ['id', 'email']),
  table('user_sessions', ['id', 'user_id']),
  table('orders', ['id', 'total']),
]
const EDGES = [{ source: 'orders', target: 'users' }]

describe('visibleNodeKey — equal filters must produce an equal key', () => {
  it('is stable across keystrokes that do not change what matches', () => {
    // "us" → "use" → "user" all match exactly {users, user_sessions}. Each keystroke used to
    // allocate a fresh Set, invalidating the node memo and re-running dagre over the whole
    // graph for an identical layout.
    const keys = ['us', 'use', 'user'].map((query) => visibleNodeKey(TABLES, EDGES, null, query))
    expect(new Set(keys).size).toBe(1)
    expect(decodeVisibleKey(keys[0]!)).toEqual(new Set(['users', 'user_sessions']))
  })

  it('changes as soon as the match set changes', () => {
    expect(visibleNodeKey(TABLES, EDGES, null, 'user')).not.toBe(
      visibleNodeKey(TABLES, EDGES, null, 'user_'),
    )
    expect(decodeVisibleKey(visibleNodeKey(TABLES, EDGES, null, 'user_'))).toEqual(
      new Set(['user_sessions']),
    )
  })

  it('is order-independent, so an id-order change alone cannot re-trigger a layout', () => {
    const reversed = [...TABLES].reverse()
    expect(visibleNodeKey(reversed, EDGES, null, '')).toBe(visibleNodeKey(TABLES, EDGES, null, ''))
  })

  it('matches on column names, not only table names', () => {
    expect(decodeVisibleKey(visibleNodeKey(TABLES, EDGES, null, 'total'))).toEqual(
      new Set(['orders']),
    )
  })

  it('an empty key decodes to no nodes, not to one blank node', () => {
    const none = visibleNodeKey(TABLES, EDGES, null, 'zzz-nothing-matches')
    expect(none).toBe('')
    expect(decodeVisibleKey(none).size).toBe(0)
  })

  it('a focus shows the table plus its direct relations, and a query overrides the focus', () => {
    expect(decodeVisibleKey(visibleNodeKey(TABLES, EDGES, 'orders', ''))).toEqual(
      new Set(['orders', 'users']),
    )
    // The UI lets a query and a focus coexist; the query is the narrower intent and wins.
    expect(decodeVisibleKey(visibleNodeKey(TABLES, EDGES, 'orders', 'total'))).toEqual(
      new Set(['orders']),
    )
  })

  it('survives an identifier a quoted name may legally contain', () => {
    // `CREATE TABLE "my table"` is valid SQL. A space-separated key would split this one id
    // into two and decode into node ids that never existed, hiding the table from the diagram.
    const spaced = [table('my table', ['id']), table('other', ['id'])]
    expect(decodeVisibleKey(visibleNodeKey(spaced, [], null, ''))).toEqual(
      new Set(['my table', 'other']),
    )
  })

  it('keeps equal table names in different schemas apart', () => {
    const collide = [table('events', ['id'], 'public'), table('events', ['id'], 'audit')]
    expect(decodeVisibleKey(visibleNodeKey(collide, [], null, 'events'))).toEqual(
      new Set([nodeIdentity('public', 'events'), nodeIdentity('audit', 'events')]),
    )
  })
})

describe('relationEdges', () => {
  const orders: DiagramTable = {
    ...table('orders', ['id', 'user_id', 'ghost_id']),
    detail: {
      ...table('orders', []).detail,
      foreignKeys: [
        { columns: ['user_id'], refTable: 'users', refColumns: ['id'] },
        { columns: ['ghost_id'], refTable: 'ghosts', refColumns: ['id'] },
      ],
    },
  }

  it('draws one edge per key column, row to row, in the board tone', () => {
    const [edge, ...rest] = relationEdges([orders, table('users', ['id'])])
    expect(rest).toEqual([])
    expect(edge).toMatchObject({
      source: 'orders',
      target: 'users',
      sourceHandle: 'user_id',
      targetHandle: 'id',
      data: { tone: 'info', route: 'step' },
    })
    // No `type`: the board's own edge draws it, so its arrow follows the theme.
    expect(edge?.type).toBeUndefined()
  })

  it('a reference to a table not on the diagram has nowhere to land and draws nothing', () => {
    expect(relationEdges([orders]).map((edge) => edge.target)).toEqual([])
  })
})

describe('layoutNodes', () => {
  const node = (id: string, columns: number) => ({
    id,
    data: { columns: Array.from({ length: columns }, (_, i) => i), hiddenColumns: 0 },
  })

  it('converts dagre centre coordinates to the board top-left origin', () => {
    const [first] = layoutNodes([node('a', 4)], [], 'LR')
    // A single node sits at dagre's margin; the conversion must subtract half the box, so the
    // top-left corner — not the centre — lands at the margin.
    expect(first!.position.x).toBe(28)
    expect(first!.position.y).toBe(28)
  })

  it('lays out a connected graph without overlapping ranks', () => {
    const laid = layoutNodes([node('a', 3), node('b', 3)], [{ source: 'a', target: 'b' }], 'LR')
    const [a, b] = laid
    expect(b!.position.x).toBeGreaterThan(a!.position.x)
  })
})
