import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import type { DbConnectionInfo, DbSchemas, DbTableSchema } from '../../dbClient'
import type { SchemaState } from '../../model/useSchema'

const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const connection: DbConnectionInfo = {
  id: 'wide',
  name: 'Wide',
  dialect: 'postgres',
  connected: true,
  readonly: false,
  createdAt: 1,
} as DbConnectionInfo

function fakeSchema(schemas: DbSchemas, overrides: Partial<SchemaState> = {}): SchemaState {
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
    ensureColumns() {},
    model: { tables: [], columnsByTable: {}, foreignKeys: [] },
    columnSources: overrides.tables ?? {},
    getColumnSource: () => undefined,
    ...overrides,
  }
}

async function mount(schema: SchemaState) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { SchemaSidebar } = await import('../SchemaSidebar')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      <SchemaSidebar
        connection={connection}
        schema={schema}
        onOpenTable={() => {}}
        onInsertColumn={() => {}}
      />,
    )
  })
  const unmount = async () => {
    await act(async () => root.unmount())
    host.remove()
  }
  return { host, act, unmount }
}

describe('schema tree — windowed', () => {
  test('5,000 tables mount a window of rows and a single context menu', async () => {
    const schemas: DbSchemas = {
      public: Array.from({ length: 5_000 }, (_, i) => ({ name: `t${i}`, type: 'table' as const })),
    }
    const { host, unmount } = await mount(fakeSchema(schemas))
    try {
      const items = host.querySelectorAll('[role="treeitem"]')
      // The nested tree mounted all 5,000 (plus 5,000 menus) before the first paint.
      expect(items.length).toBeGreaterThan(10)
      expect(items.length).toBeLessThan(60)
      // Radix marks each ContextMenu trigger with `data-state`: exactly one, on the scroller.
      const tree = host.querySelector('[role="tree"]')!
      expect(tree.getAttribute('data-state')).toBe('closed')
      expect(tree.querySelectorAll('[data-state]')).toHaveLength(0)
      // One Tab stop for the whole tree, not one per row and chevron.
      expect(tree.querySelectorAll('[tabindex="0"]')).toHaveLength(1)
    } finally {
      await unmount()
    }
  })

  test('End focuses the last table although it was never in the window', async () => {
    const schemas: DbSchemas = {
      public: Array.from({ length: 2_000 }, (_, i) => ({ name: `t${i}`, type: 'table' as const })),
    }
    const { host, act, unmount } = await mount(fakeSchema(schemas))
    try {
      const first = host.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')!
      first.focus()
      await act(async () => {
        first.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
        await turns()
      })
      const active = document.activeElement as HTMLElement | null
      expect(active?.textContent).toContain('t1999')
      expect(active?.getAttribute('tabindex')).toBe('0')
    } finally {
      await unmount()
    }
  })
})

describe('schema tree — object rows', () => {
  test('a prototype-named FK column renders as ordinary data with a keyboard-reachable jump', async () => {
    const table: DbTableSchema = {
      name: 'children',
      type: 'table',
      columns: [{ name: '__proto__', dataType: 'integer', nullable: false, pk: false }],
      primaryKey: [],
      foreignKeys: [{ columns: ['__proto__'], refTable: 'parents', refColumns: ['id'] }],
      indexes: [],
    }
    const schema = fakeSchema(
      { public: [{ name: 'children', type: 'table' }] },
      { getTable: () => table },
    )
    const { host, act, unmount } = await mount(schema)
    try {
      const expand = host.querySelector<HTMLButtonElement>('[aria-label="Expand children"]')!
      await act(async () => expand.click())
      expect(host.textContent).toContain('__proto__')
      const jump = [...host.querySelectorAll('button')].find((b) => b.textContent === '→ parents')
      // A real button (the FK jump used to be a span inside the row's button, unreachable).
      expect(jump).toBeDefined()
      const columnRow = jump!.closest<HTMLElement>('[role="treeitem"]')!
      expect(columnRow.textContent).toContain('__proto__')

      // One geometry: the column row is the same h-6, full-width band as the table above it,
      // not a `py-0.5` line inside a padded wrapper whose hover stopped short of the edge.
      const tableRow = host.querySelector<HTMLElement>(
        '[role="treeitem"][aria-expanded="true"][title^="Click"]',
      )!
      for (const row of [tableRow, columnRow]) {
        expect(row.classList.contains('h-6')).toBe(true)
        expect(row.classList.contains('w-full')).toBe(true)
      }
      expect(Number.parseInt(columnRow.style.paddingLeft)).toBeGreaterThan(
        Number.parseInt(tableRow.style.paddingLeft),
      )
      // Open is not hover: the expanded row used to be painted `bg-surface-hover`.
      expect(tableRow.classList.contains('bg-surface-hover')).toBe(false)
      await act(async () => tableRow.click())
      expect(tableRow.classList.contains('bg-surface-active')).toBe(true)
    } finally {
      await unmount()
    }
  })

  test('an unreadable object offers a retry instead of an ellipsis that never resolves', async () => {
    const reloaded: Array<[string, string | undefined]> = []
    const schema = fakeSchema(
      { public: [{ name: 'orders', type: 'table' }] },
      {
        getTableError: () => 'permission denied for table orders',
        reloadTable: (table, schemaName) => {
          reloaded.push([table, schemaName])
        },
      },
    )
    const { host, act, unmount } = await mount(schema)
    try {
      await act(async () =>
        host.querySelector<HTMLButtonElement>('[aria-label="Expand orders"]')!.click(),
      )
      const retry = [...host.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Could not read columns'),
      )
      expect(retry?.title).toBe('permission denied for table orders')
      await act(async () => retry!.click())
      // One namespace: reads are unqualified, exactly as the nested tree issued them.
      expect(reloaded).toEqual([['orders', undefined]])
    } finally {
      await unmount()
    }
  })
})
