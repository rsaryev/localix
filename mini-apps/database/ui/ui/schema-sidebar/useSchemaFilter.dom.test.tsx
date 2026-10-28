import { afterAll, beforeAll, describe, expect, jest, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import type { DbSchemas } from '../../dbClient'
import type { SchemaState } from '../../model/useSchema'
import {
  COLUMN_SEARCH_CAP,
  COLUMN_SEARCH_DEBOUNCE_MS,
  columnSearchTargets,
  type SchemaGroups,
  type useSchemaFilter as UseSchemaFilter,
} from './useSchemaFilter'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

const wide = (count: number): DbSchemas => ({
  public: Array.from({ length: count }, (_, i) => ({
    name: `orders_${i}`,
    type: 'table' as const,
  })),
})

function fakeSchema(schemas: DbSchemas, ensured: Array<unknown[]>): SchemaState {
  return {
    schemas,
    loading: false,
    error: null,
    errorDetail: null,
    reload() {},
    tables: {},
    getTable: () => undefined,
    getTableError: () => undefined,
    getTableErrorDetail: () => undefined,
    loadTable() {},
    reloadTable() {},
    ensureColumns: (wanted) => ensured.push(wanted),
    columnSources: {},
    getColumnSource: () => undefined,
    model: { tables: [], columnsByTable: {}, foreignKeys: [] },
  }
}

describe('useSchemaFilter — a name search reads no columns', () => {
  test('typing a table name never introspects; opting into columns reads a bounded set', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { useSchemaFilter } = await import('./useSchemaFilter')

    const ensured: Array<unknown[]> = []
    // Stable across renders, as the real hook's value is between store commits.
    const schema = fakeSchema(wide(5_000), ensured)
    let state: ReturnType<typeof UseSchemaFilter> | undefined
    function Reader() {
      const latest = useSchemaFilter(schema)
      React.useEffect(() => {
        state = latest
      })
      return null
    }
    // Fake timers: the debounces are waited out by advancing the clock, not by sleeping on it.
    jest.useFakeTimers()
    const wait = (ms: number) => jest.advanceTimersByTime(ms)
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Reader />))
      await act(async () => state!.setFilter('orders_42'))
      await act(async () => wait(COLUMN_SEARCH_DEBOUNCE_MS + 250))
      // The first keystroke used to queue all 5,000 objects for introspection.
      expect(ensured).toHaveLength(0)
      expect(state!.filtered[0]?.[1].map((m) => m.item.name)).toContain('orders_42')

      await act(async () => state!.setSearchColumns(true))
      await act(async () => wait(COLUMN_SEARCH_DEBOUNCE_MS + 100))
      expect(ensured).toHaveLength(1)
      expect(ensured[0]).toHaveLength(COLUMN_SEARCH_CAP)
      expect(state!.columnSearchScope).toBe(COLUMN_SEARCH_CAP)
    } finally {
      await act(async () => root.unmount())
      jest.useRealTimers()
    }
  })
})

describe('columnSearchTargets', () => {
  test('keeps tree order, qualifies names only when there are several schemas, and caps', () => {
    const groups: SchemaGroups = [
      ['a', [{ name: 'x', type: 'table' }]],
      [
        'b',
        [
          { name: 'y', type: 'table' },
          { name: 'z', type: 'view' },
        ],
      ],
    ]
    expect(columnSearchTargets(groups, false, 2)).toEqual([
      { name: 'x', schema: 'a' },
      { name: 'y', schema: 'b' },
    ])
    expect(columnSearchTargets([groups[0]], true)).toEqual([{ name: 'x', schema: undefined }])
  })
})
